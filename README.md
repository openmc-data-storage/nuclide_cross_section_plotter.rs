This repository hosts the source code for the Nuclide Cross Section Plotter hosted on [xsplot.com](https://xsplot.com)

[Direct link to the webapp](https://openmc-data-storage.github.io/nuclide_cross_section_plotter.rs/index.html)

The web app allows users to search a database of neutron cross sections, filter the results, plot graphs and download the data.

You can install the dependencies and build the web app locally with these instructions that have been tested on Ubuntu 22.04
```bash
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
