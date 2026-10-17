//! sumi-svg2pdf [--text-to-paths] <in.svg> <out.pdf> <font.ttf>...

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let text_to_paths = args.first().is_some_and(|a| a == "--text-to-paths");
    if text_to_paths {
        args.remove(0);
    }
    if args.len() < 3 {
        eprintln!("usage: sumi-svg2pdf [--text-to-paths] <in.svg> <out.pdf> <font.ttf>...");
        std::process::exit(2);
    }
    let svg = std::fs::read(&args[0]).expect("read svg");
    let fonts = args[2..].iter().map(|p| std::fs::read(p).expect("read font")).collect();
    match sumi_svg2pdf_poc::convert(&svg, fonts, text_to_paths) {
        Ok(pdf) => std::fs::write(&args[1], pdf).expect("write pdf"),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    }
}
