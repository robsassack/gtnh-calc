# GTNH Calculator

[![Tests](https://github.com/ShadowTheAge/gtnh/actions/workflows/deploy.yml/badge.svg)](https://github.com/ShadowTheAge/gtnh/actions/workflows/deploy.yml)

A calculator for GregTech: New Horizons recipes and production chains.
Large parts of this project were written using AI assistance, so code style and quality are all over the place.
I just wanted to quickly put together something I can use to calculate GTNH chains. After this goal is done, it won't be an actively maintained project.

Data building is done using the NESQL Exporter mod and a C# processing tool. See [export/README.md](export/README.md) for detailed instructions.

## Development

To run this project locally:

1. Clone the repository with its data submodule:
```bash
git clone --recursive https://github.com/ShadowTheAge/gtnh.git
```

If you already cloned it, initialize the submodule from the repository directory:
```bash
git submodule update --init --recursive
```

2. Install dependencies:
```bash
npm install
```
3. Start the development server:
```bash
npm start
```

## License

The code is under the MIT License - see the [LICENSE](LICENSE) file for details.

However, the project contains some assets from Minecraft (Mojang trademark and copyright), the GTNH development team, and respective mod authors. These assets are used under fair use.

Font used: [F77 Minecraft by 123467](https://www.fontspace.com/f77-minecraft-font-f30628)
