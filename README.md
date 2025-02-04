[Demo](https://shimwell.github.io/nuclide_cross_section_plotter.rs/)

Install instructions on Ubuntu 22.04
```
sudo apt-get update
sudo apt-get install curl
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"
sudo apt install build-essential -y
rustup target add wasm32-unknown-unknown
cargo clean
cargo build --target wasm32-unknown-unknown --release
cargo install --locked trunk
trunk serve --open
```
