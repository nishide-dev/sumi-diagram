//! #19 research PoC: converts a Sumi SVG (with font families already resolved
//! to the bundled fonts, see `scripts/lib/svg-fonts.ts`) to a vector PDF with
//! svg2pdf. The font database holds only the given TTFs, so the output never
//! depends on the fonts installed on the machine.
//!
//! Built natively (`sumi-svg2pdf` binary) and for `wasm32-unknown-unknown`
//! (raw C ABI below, no wasm-bindgen) to check whether Bun could run it from
//! inside the single binary.

use std::sync::Arc;

pub fn convert(svg: &[u8], fonts: Vec<Vec<u8>>, text_to_paths: bool) -> Result<Vec<u8>, String> {
    let mut db = fontdb::Database::new();
    for font in fonts {
        db.load_font_data(font);
    }
    // Anything the SVG does not name resolves to the regular face, never a system font.
    db.set_sans_serif_family("BIZ UDPGothic");
    db.set_serif_family("BIZ UDPGothic");
    db.set_monospace_family("BIZ UDGothic");

    let options = usvg::Options {
        fontdb: Arc::new(db),
        font_family: "BIZ UDPGothic".to_string(),
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_data(svg, &options).map_err(|e| e.to_string())?;
    let conversion = svg2pdf::ConversionOptions {
        embed_text: !text_to_paths,
        ..svg2pdf::ConversionOptions::default()
    };
    // usvg resolves the root `width="446pt"` to CSS px (96 per inch); dpi 96
    // maps px back to pt, so the page is exactly the root width/height in pt.
    // (The default, 72, makes the page 4/3 too large.)
    let page = svg2pdf::PageOptions { dpi: 96.0 };
    svg2pdf::to_pdf(&tree, conversion, page).map_err(|e| e.to_string())
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::cell::RefCell;

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

    #[no_mangle]
    pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }

    /// Takes ownership of a buffer from `alloc` as one font file.
    #[no_mangle]
    pub unsafe extern "C" fn add_font(ptr: *mut u8, len: usize) {
        let font = Vec::from_raw_parts(ptr, len, len);
        FONTS.with(|f| f.borrow_mut().push(font));
    }

    /// Converts the SVG; returns the PDF length (0 on error, the message is then the output).
    #[no_mangle]
    pub unsafe extern "C" fn convert(ptr: *mut u8, len: usize, text_to_paths: u32) -> isize {
        let svg = Vec::from_raw_parts(ptr, len, len);
        let fonts = FONTS.with(|f| f.borrow().clone());
        match super::convert(&svg, fonts, text_to_paths != 0) {
            Ok(pdf) => {
                let n = pdf.len() as isize;
                OUTPUT.with(|o| *o.borrow_mut() = pdf);
                n
            }
            Err(message) => {
                let n = message.len() as isize;
                OUTPUT.with(|o| *o.borrow_mut() = message.into_bytes());
                -n
            }
        }
    }

    #[no_mangle]
    pub extern "C" fn output_ptr() -> *const u8 {
        OUTPUT.with(|o| o.borrow().as_ptr())
    }
}
