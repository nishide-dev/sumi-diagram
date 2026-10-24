//! Sumi's SVG → vector PDF engine (#74), compiled to `wasm32-unknown-unknown`
//! and called from Bun through the raw C ABI below (no wasm-bindgen, no WASI,
//! no host imports). See `src/render/pdf/engine.ts`.
//!
//! The SVG must already name the bundled fonts by their real family names
//! (`src/render/pdf/fonts.ts` rewrites D2's per-diagram `@font-face` names).
//! The font database holds only the font files passed in with `add_font`, so
//! the output never depends on the fonts installed on the machine. The first
//! font added is the fallback for anything the SVG does not name.

use std::cell::RefCell;
use std::sync::Arc;

use krilla::configure::{ConfigurationBuilder, PdfVersion};
use krilla::geom::Size;
use krilla::metadata::Metadata;
use krilla::page::PageSettings;
use krilla::{Document, SerializeSettings};
use krilla_svg::{SurfaceExt, SvgSettings};

fn parse_svg(svg: &[u8], fonts: Vec<Vec<u8>>) -> Result<usvg::Tree, String> {
    let mut db = fontdb::Database::new();
    for font in fonts {
        db.load_font_data(font);
    }
    let fallback = db
        .faces()
        .next()
        .and_then(|face| face.families.first())
        .map(|(name, _)| name.clone())
        .ok_or_else(|| "no usable font was given".to_string())?;
    db.set_sans_serif_family(fallback.clone());
    db.set_serif_family(fallback.clone());
    db.set_monospace_family(fallback.clone());
    db.set_cursive_family(fallback.clone());
    db.set_fantasy_family(fallback.clone());

    let options = usvg::Options {
        fontdb: Arc::new(db),
        font_family: fallback,
        ..usvg::Options::default()
    };
    usvg::Tree::from_data(svg, &options).map_err(|e| e.to_string())
}

fn convert_svg(svg: &[u8], fonts: Vec<Vec<u8>>) -> Result<Vec<u8>, String> {
    let tree = parse_svg(svg, fonts)?;
    let settings = SerializeSettings {
        configuration: ConfigurationBuilder::new()
            .with_version(PdfVersion::Pdf17)
            .finish()
            .map_err(|e| format!("{e:?}"))?,
        xmp_metadata: false,
        ..Default::default()
    };
    let mut document = Document::new_with(settings);
    // A checked marker for the provenance dictionary replacement in info.ts.
    document.set_metadata(Metadata::new().producer("Sumi krilla".into()));
    // usvg resolves root pt into CSS px (96/in). PDF coordinates are pt (72/in).
    let size = Size::from_wh(tree.size().width() * 0.75, tree.size().height() * 0.75)
        .ok_or_else(|| "invalid page size".to_string())?;
    let mut page = document.start_page_with(PageSettings::new(size));
    let mut surface = page.surface();
    surface.draw_svg(&tree, size, SvgSettings::default());
    surface.finish();
    page.finish();
    document.finish().map_err(|e| format!("{e:?}"))
}

fn picture_assets(svg: &[u8], fonts: Vec<Vec<u8>>) -> Result<Vec<u8>, String> {
    let tree = parse_svg(svg, fonts)?;
    let w = tree.size().width();
    let h = tree.size().height();
    // Aim for 192 dpi (usvg's CSS px are 96/in). Bound allocation to 64 MiB
    // RGBA and 8192px per side; large pictures get a lower-resolution fallback.
    let scale = 2.0_f32
        .min(8192.0 / w)
        .min(8192.0 / h)
        .min((16_000_000.0 / (w * h)).sqrt());
    let width = ((w * scale).ceil() as u32).min(8192);
    let height = ((h * scale).ceil() as u32).min(8192);
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 16_100_000 {
        return Err("invalid or excessive raster dimensions".into());
    }
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| "cannot allocate raster fallback".to_string())?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    let png = pixmap.encode_png().map_err(|e| e.to_string())?;
    let outlined = tree.to_string(&usvg::WriteOptions {
        preserve_text: false,
        ..Default::default()
    });
    // LE u32 PNG length, then PNG, then UTF-8 outlined SVG.
    let mut result = Vec::with_capacity(4 + png.len() + outlined.len());
    result.extend_from_slice(&(png.len() as u32).to_le_bytes());
    result.extend_from_slice(&png);
    result.extend_from_slice(outlined.as_bytes());
    Ok(result)
}

thread_local! {
    static FONTS: RefCell<Vec<Vec<u8>>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Allocates `len` bytes for the host to fill (ownership passes to `add_font` / `convert`).
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Takes ownership of a buffer from `alloc` holding one font file.
///
/// # Safety
/// `ptr` / `len` must come from `alloc(len)`, filled by the host.
#[no_mangle]
pub unsafe extern "C" fn add_font(ptr: *mut u8, len: usize) {
    let font = Vec::from_raw_parts(ptr, len, len);
    FONTS.with(|f| f.borrow_mut().push(font));
}

/// Converts the SVG (a buffer from `alloc`, consumed) with the fonts added so
/// far (consumed too). Returns the PDF's length, or the negated length of a
/// UTF-8 error message; either is then readable at `output_ptr()`.
///
/// # Safety
/// `ptr` / `len` must come from `alloc(len)`, filled by the host.
#[no_mangle]
pub unsafe extern "C" fn convert(ptr: *mut u8, len: usize) -> isize {
    transform(ptr, len, convert_svg)
}

/// Produces outlined SVG and PNG assets for a picture PPTX (#61).
/// # Safety
/// `ptr` / `len` must come from `alloc(len)`, filled by the host.
#[no_mangle]
pub unsafe extern "C" fn picture(ptr: *mut u8, len: usize) -> isize {
    transform(ptr, len, picture_assets)
}

unsafe fn transform(
    ptr: *mut u8,
    len: usize,
    operation: fn(&[u8], Vec<Vec<u8>>) -> Result<Vec<u8>, String>,
) -> isize {
    let svg = Vec::from_raw_parts(ptr, len, len);
    let fonts = FONTS.with(|f| std::mem::take(&mut *f.borrow_mut()));
    let (bytes, ok) = match operation(&svg, fonts) {
        Ok(pdf) => (pdf, true),
        Err(message) => (message.into_bytes(), false),
    };
    let n = bytes.len() as isize;
    OUTPUT.with(|o| *o.borrow_mut() = bytes);
    if ok {
        n
    } else {
        -n
    }
}

/// Address of the last `convert` result.
#[no_mangle]
pub extern "C" fn output_ptr() -> *const u8 {
    OUTPUT.with(|o| o.borrow().as_ptr())
}
