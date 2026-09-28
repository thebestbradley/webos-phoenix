# Building the OS image on a Mac

There are two things you can build:

| What | How | Time |
| --- | --- | --- |
| The Phoenix UI simulator | Natively on macOS, see the README | A minute |
| A full webOS Phoenix OS image | In a Linux container, this page | Hours the first time |

This page is for the second one. It uses Apple's
[`container`](https://github.com/apple/container) tool, which runs Linux
containers as lightweight virtual machines.

## Requirements

- A Mac with Apple silicon, running **macOS 26** (required by `container`)
- `container` installed from its [releases page](https://github.com/apple/container/releases)
- **16 GB of RAM or more** (Chromium, part of webOS OSE, is a very large build)
- **About 300 GB of free disk**. The build volume grows as it fills, up to that size.
- Rosetta. macOS offers to install it the first time an x86-64 container runs.

## Why x86-64 (Rosetta)?

webOS OSE only supports **x86-64 build machines**. Its build scripts check for
Ubuntu 20.04/22.04 amd64 and need 32-bit compiler packages that don't exist for
ARM Linux. So the build container runs x86-64 Linux, translated by Rosetta.
That's slower than native, but it works.

This only affects the *build machine*. The OS you build can still target
ARM64 devices: OSE cross-compiles, and `raspberrypi4-64` (and later phones
such as the PinePhone) are ARM64 targets. Making the build itself run natively
on ARM64 is on the roadmap.

## Build

From your checkout:

```sh
scripts/mac-build.sh --check              # quick check first: fetch layers and resolve
                                          # the whole image without compiling
scripts/mac-build.sh                      # qemux86-64 emulator image
scripts/mac-build.sh raspberrypi4-64      # 64-bit Raspberry Pi 4 image
scripts/mac-build.sh --shell              # just open a shell in the build container
```

The first run:

1. starts the `container` services
2. builds the `webos-phoenix-build` image (Ubuntu 22.04 with OSE's build tools)
3. creates `webos-phoenix-work`, an ext4 volume for the build. Yocto needs a
   case-sensitive filesystem, and the Mac's default one isn't.
4. clones webOS OSE `build-webos` at the pinned commit, adds `meta-phoenix`,
   and runs `bitbake webos-phoenix-image`

Your checkout is mounted into the container at `/src/webos-phoenix`, and the
Phoenix shell is built from it (`externalsrc`). Edit on the Mac, re-run the
script, and the image picks up your changes. Everything the build writes stays
in the volume, and re-runs only rebuild what changed.

By default the container gets all but two CPU cores and three quarters of your
RAM. Override with `PHOENIX_CPUS=8 PHOENIX_MEMORY=24g scripts/mac-build.sh`.

## Where the output goes

Images are in `/work/build-webos-phoenix/BUILD/deploy/images/<machine>/`
inside the volume. To copy them to the Mac:

```sh
scripts/mac-build.sh --shell
# inside the container:
cp /work/build-webos-phoenix/BUILD/deploy/images/raspberrypi4-64/*.wic* /src/webos-phoenix/out/
```

`--check` is worth running first. It sets everything up and has BitBake parse
all of webOS OSE (about 3,400 recipes) and resolve `webos-phoenix-image`,
which catches setup problems in minutes instead of hours into a build.

## Troubleshooting

- **The build is killed or Chromium fails to link**: give the container more
  memory (`PHOENIX_MEMORY=28g`), or fewer CPUs (each parallel job needs memory).
- **"not a case-sensitive filesystem"**: the build directory must be on the
  `webos-phoenix-work` volume, not your Mac folder.
- **Start over**: `container volume delete webos-phoenix-work` removes the whole
  build. It's large, so only do this if you mean it.
