//! Research-only krilla engine, using the production engine's raw ABI.
use std::cell::RefCell;
use std::sync::Arc;

use krilla::configure::{ConfigurationBuilder, PdfVersion};
use krilla::geom::Size;
use krilla::metadata::Metadata;
use krilla::page::PageSettings;
use krilla::{Document, SerializeSettings};
use krilla_svg::{SurfaceExt, SvgSettings};

fn convert_svg(svg: &[u8], fonts: Vec<Vec<u8>>) -> Result<Vec<u8>, String> {
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
        ..Default::default()
    };
    let tree = usvg::Tree::from_data(svg, &options).map_err(|e| e.to_string())?;
    let settings = SerializeSettings {
        configuration: ConfigurationBuilder::new()
            .with_version(PdfVersion::Pdf17)
            .finish()
            .map_err(|e| format!("{e:?}"))?,
        xmp_metadata: false,
        ..Default::default()
    };
    let mut document = Document::new_with(settings);
    document.set_metadata(Metadata::new().producer("Sumi krilla evaluation".into()));
    // usvg resolves pt to CSS pixels at 96 dpi. PDF coordinates are points.
    let size = Size::from_wh(tree.size().width() * 0.75, tree.size().height() * 0.75)
        .ok_or_else(|| "invalid page size".to_string())?;
    let mut page = document.start_page_with(PageSettings::new(size));
    let mut surface = page.surface();
    surface.draw_svg(&tree, size, SvgSettings::default());
    surface.finish();
    page.finish();
    document.finish().map_err(|e| format!("{e:?}"))
}

thread_local! {
    static FONTS: RefCell<Vec<Vec<u8>>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` must be an initialized buffer returned by `alloc(len)`.
#[no_mangle]
pub unsafe extern "C" fn add_font(ptr: *mut u8, len: usize) {
    FONTS.with(|f| f.borrow_mut().push(Vec::from_raw_parts(ptr, len, len)));
}

/// # Safety
/// `ptr` must be an initialized buffer returned by `alloc(len)`.
#[no_mangle]
pub unsafe extern "C" fn convert(ptr: *mut u8, len: usize) -> isize {
    let svg = Vec::from_raw_parts(ptr, len, len);
    let fonts = FONTS.with(|f| std::mem::take(&mut *f.borrow_mut()));
    let (bytes, ok) = match convert_svg(&svg, fonts) {
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

#[no_mangle]
pub extern "C" fn output_ptr() -> *const u8 {
    OUTPUT.with(|o| o.borrow().as_ptr())
}
