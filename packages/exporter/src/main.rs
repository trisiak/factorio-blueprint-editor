use hyper::service::service_fn;
use hyper_staticfile::Static;
use hyper_util::rt::TokioIo;
use std::path::Path;
use std::path::PathBuf;
use tokio::net::TcpListener;

mod setup;

#[macro_use]
extern crate lazy_static;

static FACTORIO_VERSION: &str = "2.0.76";

lazy_static! {
    static ref DATA_DIR: PathBuf = PathBuf::from("./data");
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv()?;

    // Which pack to (re)generate. `--pack <id>` (or `--pack=<id>`) selects an
    // entry from data/output/packs.json; without it we fall back to the
    // manifest's `default: true` pack (vanilla-2.0). The pack's `mods` list
    // drives the generated mod-list.json, and the dump lands in
    // data/output/<id>/ alongside the other packs.
    let pack_arg = parse_pack_arg();
    let packs = setup::read_packs(&DATA_DIR.join("output").join("packs.json")).await?;
    let pack = setup::select_pack(&packs, pack_arg.as_deref())?;
    let all_mods = setup::all_known_mods(&packs);
    println!(
        "Exporting pack '{}' (mods: {})",
        pack.id,
        pack.mods.join(", ")
    );

    let factorio_dir_name = match std::env::consts::OS {
        "linux" => "factorio",
        "windows" => &format!("Factorio_{FACTORIO_VERSION}"),
        _ => panic!("unsupported OS"),
    };
    let output_dir = DATA_DIR.join("output").join(&pack.id);
    let base_factorio_dir = DATA_DIR.join(factorio_dir_name);

    setup::download_factorio(&DATA_DIR, &base_factorio_dir, FACTORIO_VERSION, pack).await?;
    // After the game download — a build re-download wipes the install (and the
    // mods/ dir with it); portal mods then reinstall from the zip cache.
    setup::download_portal_mods(&DATA_DIR, &base_factorio_dir, pack).await?;
    setup::extract(&output_dir, &base_factorio_dir, pack, &all_mods).await?;

    let static_ = Static::new(Path::new("data/output/"));

    let listener = TcpListener::bind(std::net::SocketAddr::from(([127, 0, 0, 1], 8081))).await?;

    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);

        let static_ = static_.clone();
        tokio::spawn(async move {
            if let Err(err) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, service_fn(|req| static_.clone().serve(req)))
                .await
            {
                eprintln!("Error serving connection: {}", err);
            }
        });
    }
}

/// Parse `--pack <id>` / `--pack=<id>` from argv; returns `None` when absent.
fn parse_pack_arg() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--pack" {
            return args.next();
        }
        if let Some(value) = arg.strip_prefix("--pack=") {
            return Some(value.to_string());
        }
    }
    None
}
