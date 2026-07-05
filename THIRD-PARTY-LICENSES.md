# Third-Party Licenses

DownMan is distributed as source and as prebuilt binaries (`.deb`, AppImage). Those
binaries statically include the Rust crates and JavaScript libraries listed below, all
under permissive licenses. This file is provided for attribution; it is generated from
`cargo metadata` + `package.json`.

The engines DownMan *invokes as separate processes* — **aria2** (GPL-2.0-or-later),
**FFmpeg** (LGPL/GPL) and **yt-dlp** (Unlicense) — are **not** bundled (see `LICENSE`).
AppImage builds additionally bundle **WebKitGTK/GTK** (LGPL-2.1+); the LGPL permits
replacing those libraries in the AppImage, and their source is available from the GNOME
project and your distribution.

## License summary (bundled Rust crates)

- **259** × MIT OR Apache-2.0
- **125** × MIT
- **53** × Apache-2.0 OR MIT
- **27** × MIT/Apache-2.0
- **18** × Unicode-3.0
- **17** × Zlib OR Apache-2.0 OR MIT
- **5** × Unlicense OR MIT
- **5** × MPL-2.0
- **5** × Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT
- **4** × Apache-2.0/MIT
- **4** × Apache-2.0
- **4** × MIT OR Apache-2.0 OR Zlib
- **3** × BSD-3-Clause
- **3** × ISC
- **2** × BSL-1.0
- **2** × Apache-2.0 OR ISC OR MIT
- **2** × BSD-3-Clause OR Apache-2.0
- **2** × BSD-3-Clause OR MIT OR Apache-2.0
- **2** × MIT OR Apache-2.0 OR LGPL-2.1-or-later
- **2** × Unlicense/MIT
- **2** × BSD-2-Clause OR Apache-2.0 OR MIT
- **1** × 0BSD OR MIT OR Apache-2.0
- **1** × BSD-3-Clause AND MIT
- **1** × BSD-3-Clause/MIT
- **1** × Apache-2.0 AND MIT
- **1** × CC0-1.0 OR MIT-0 OR Apache-2.0
- **1** × (Apache-2.0 OR MIT) AND BSD-3-Clause
- **1** × Apache-2.0 / MIT
- **1** × Zlib
- **1** × MIT OR Zlib OR Apache-2.0
- **1** × Apache-2.0 AND ISC
- **1** × Apache-2.0 OR BSL-1.0
- **1** × Apache-2.0 WITH LLVM-exception
- **1** × (MIT OR Apache-2.0) AND Unicode-3.0

## Rust crates

| Crate | Version | License (SPDX) |
|---|---|---|
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| aho-corasick | 1.1.4 | Unlicense OR MIT |
| alloc-no-stdlib | 2.0.4 | BSD-3-Clause |
| alloc-stdlib | 0.2.4 | BSD-3-Clause |
| android_system_properties | 0.1.5 | MIT/Apache-2.0 |
| anyhow | 1.0.103 | MIT OR Apache-2.0 |
| arboard | 3.6.1 | MIT OR Apache-2.0 |
| ascii | 1.1.0 | Apache-2.0 OR MIT |
| async-broadcast | 0.7.2 | MIT OR Apache-2.0 |
| async-channel | 2.5.0 | Apache-2.0 OR MIT |
| async-executor | 1.14.0 | Apache-2.0 OR MIT |
| async-io | 2.6.0 | Apache-2.0 OR MIT |
| async-lock | 3.4.2 | Apache-2.0 OR MIT |
| async-process | 2.5.0 | Apache-2.0 OR MIT |
| async-recursion | 1.1.1 | MIT OR Apache-2.0 |
| async-signal | 0.2.14 | Apache-2.0 OR MIT |
| async-task | 4.7.1 | Apache-2.0 OR MIT |
| async-trait | 0.1.89 | MIT OR Apache-2.0 |
| atk | 0.18.2 | MIT |
| atk-sys | 0.18.2 | MIT |
| atomic-waker | 1.1.2 | Apache-2.0 OR MIT |
| autocfg | 1.5.1 | Apache-2.0 OR MIT |
| base64 | 0.22.1 | MIT OR Apache-2.0 |
| base64 | 0.21.7 | MIT OR Apache-2.0 |
| bit-set | 0.8.0 | Apache-2.0 OR MIT |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT |
| bitflags | 2.13.0 | MIT OR Apache-2.0 |
| bitflags | 1.3.2 | MIT/Apache-2.0 |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 |
| block2 | 0.6.2 | MIT |
| blocking | 1.6.2 | Apache-2.0 OR MIT |
| brotli | 8.0.4 | BSD-3-Clause AND MIT |
| brotli-decompressor | 5.0.3 | BSD-3-Clause/MIT |
| bs58 | 0.5.1 | MIT/Apache-2.0 |
| bumpalo | 3.20.3 | MIT OR Apache-2.0 |
| bytemuck | 1.25.0 | Zlib OR Apache-2.0 OR MIT |
| byteorder | 1.5.0 | Unlicense OR MIT |
| byteorder-lite | 0.1.0 | Unlicense OR MIT |
| bytes | 1.12.0 | MIT |
| cairo-rs | 0.18.5 | MIT |
| cairo-sys-rs | 0.18.2 | MIT |
| camino | 1.2.4 | MIT OR Apache-2.0 |
| cargo-platform | 0.1.9 | MIT OR Apache-2.0 |
| cargo_metadata | 0.19.2 | MIT |
| cargo_toml | 0.22.3 | Apache-2.0 OR MIT |
| cc | 1.2.65 | MIT OR Apache-2.0 |
| cesu8 | 1.1.0 | Apache-2.0/MIT |
| cfb | 0.7.3 | MIT |
| cfg-expr | 0.15.8 | MIT OR Apache-2.0 |
| cfg-if | 1.0.4 | MIT OR Apache-2.0 |
| chrono | 0.4.45 | MIT OR Apache-2.0 |
| chunked_transfer | 1.5.0 | MIT OR Apache-2.0 |
| clipboard-win | 5.4.1 | BSL-1.0 |
| combine | 4.6.7 | MIT |
| concurrent-queue | 2.5.0 | Apache-2.0 OR MIT |
| cookie | 0.18.1 | MIT OR Apache-2.0 |
| core-foundation | 0.10.1 | MIT OR Apache-2.0 |
| core-foundation | 0.9.4 | MIT OR Apache-2.0 |
| core-foundation-sys | 0.8.7 | MIT OR Apache-2.0 |
| core-graphics | 0.25.0 | MIT OR Apache-2.0 |
| core-graphics-types | 0.2.0 | MIT OR Apache-2.0 |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 |
| crc32fast | 1.5.0 | MIT OR Apache-2.0 |
| crossbeam-channel | 0.5.15 | MIT OR Apache-2.0 |
| crossbeam-utils | 0.8.21 | MIT OR Apache-2.0 |
| crunchy | 0.2.4 | MIT |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 |
| cssparser | 0.36.0 | MPL-2.0 |
| cssparser-macros | 0.6.1 | MPL-2.0 |
| ctor | 0.8.0 | Apache-2.0 OR MIT |
| ctor-proc-macro | 0.0.7 | Apache-2.0 OR MIT |
| darling | 0.23.0 | MIT |
| darling_core | 0.23.0 | MIT |
| darling_macro | 0.23.0 | MIT |
| dbus | 0.9.11 | Apache-2.0/MIT |
| deranged | 0.5.8 | MIT OR Apache-2.0 |
| derive_more | 2.1.1 | MIT |
| derive_more-impl | 2.1.1 | MIT |
| digest | 0.10.7 | MIT OR Apache-2.0 |
| dirs | 6.0.0 | MIT OR Apache-2.0 |
| dirs | 5.0.1 | MIT OR Apache-2.0 |
| dirs-sys | 0.4.1 | MIT OR Apache-2.0 |
| dirs-sys | 0.5.0 | MIT OR Apache-2.0 |
| dispatch2 | 0.3.1 | Zlib OR Apache-2.0 OR MIT |
| displaydoc | 0.2.6 | MIT OR Apache-2.0 |
| dlopen2 | 0.8.2 | MIT |
| dlopen2_derive | 0.4.3 | MIT |
| dom_query | 0.27.0 | MIT |
| dpi | 0.1.2 | Apache-2.0 AND MIT |
| dtoa | 1.0.11 | MIT OR Apache-2.0 |
| dtoa-short | 0.3.5 | MPL-2.0 |
| dtor | 0.3.0 | Apache-2.0 OR MIT |
| dtor-proc-macro | 0.0.6 | Apache-2.0 OR MIT |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| dyn-clone | 1.0.20 | MIT OR Apache-2.0 |
| embed-resource | 3.0.9 | MIT |
| embed_plist | 1.2.2 | MIT OR Apache-2.0 |
| encoding_rs | 0.8.35 | (Apache-2.0 OR MIT) AND BSD-3-Clause |
| endi | 1.1.1 | MIT |
| enumflags2 | 0.7.12 | MIT OR Apache-2.0 |
| enumflags2_derive | 0.7.12 | MIT OR Apache-2.0 |
| equivalent | 1.0.2 | Apache-2.0 OR MIT |
| erased-serde | 0.4.10 | MIT OR Apache-2.0 |
| errno | 0.3.14 | MIT OR Apache-2.0 |
| error-code | 3.3.2 | BSL-1.0 |
| event-listener | 5.4.1 | Apache-2.0 OR MIT |
| event-listener-strategy | 0.5.4 | Apache-2.0 OR MIT |
| fastrand | 2.4.1 | Apache-2.0 OR MIT |
| fax | 0.2.7 | MIT |
| fdeflate | 0.3.7 | MIT OR Apache-2.0 |
| field-offset | 0.3.6 | MIT OR Apache-2.0 |
| find-msvc-tools | 0.1.9 | MIT OR Apache-2.0 |
| flate2 | 1.1.9 | MIT OR Apache-2.0 |
| fnv | 1.0.7 | Apache-2.0 / MIT |
| foldhash | 0.2.0 | Zlib |
| foreign-types | 0.3.2 | MIT/Apache-2.0 |
| foreign-types | 0.5.0 | MIT/Apache-2.0 |
| foreign-types-macros | 0.2.3 | MIT/Apache-2.0 |
| foreign-types-shared | 0.1.1 | MIT/Apache-2.0 |
| foreign-types-shared | 0.3.1 | MIT/Apache-2.0 |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 |
| futures-channel | 0.3.32 | MIT OR Apache-2.0 |
| futures-core | 0.3.32 | MIT OR Apache-2.0 |
| futures-executor | 0.3.32 | MIT OR Apache-2.0 |
| futures-io | 0.3.32 | MIT OR Apache-2.0 |
| futures-lite | 2.6.1 | Apache-2.0 OR MIT |
| futures-macro | 0.3.32 | MIT OR Apache-2.0 |
| futures-sink | 0.3.32 | MIT OR Apache-2.0 |
| futures-task | 0.3.32 | MIT OR Apache-2.0 |
| futures-util | 0.3.32 | MIT OR Apache-2.0 |
| gdk | 0.18.2 | MIT |
| gdk-pixbuf | 0.18.5 | MIT |
| gdk-pixbuf-sys | 0.18.0 | MIT |
| gdk-sys | 0.18.2 | MIT |
| gdkwayland-sys | 0.18.2 | MIT |
| gdkx11 | 0.18.2 | MIT |
| gdkx11-sys | 0.18.2 | MIT |
| generic-array | 0.14.7 | MIT |
| gethostname | 1.1.0 | Apache-2.0 |
| getrandom | 0.3.4 | MIT OR Apache-2.0 |
| getrandom | 0.2.17 | MIT OR Apache-2.0 |
| getrandom | 0.4.3 | MIT OR Apache-2.0 |
| gio | 0.18.4 | MIT |
| gio-sys | 0.18.1 | MIT |
| glib | 0.18.5 | MIT |
| glib-macros | 0.18.5 | MIT |
| glib-sys | 0.18.1 | MIT |
| glob | 0.3.3 | MIT OR Apache-2.0 |
| gobject-sys | 0.18.0 | MIT |
| gtk | 0.18.2 | MIT |
| gtk-sys | 0.18.2 | MIT |
| gtk3-macros | 0.18.2 | MIT |
| h2 | 0.4.15 | MIT |
| half | 2.7.1 | MIT OR Apache-2.0 |
| hashbrown | 0.12.3 | MIT OR Apache-2.0 |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 |
| heck | 0.4.1 | MIT OR Apache-2.0 |
| heck | 0.5.0 | MIT OR Apache-2.0 |
| hermit-abi | 0.5.2 | MIT OR Apache-2.0 |
| hex | 0.4.3 | MIT OR Apache-2.0 |
| html5ever | 0.38.0 | MIT OR Apache-2.0 |
| http | 1.4.2 | MIT OR Apache-2.0 |
| http-body | 1.0.1 | MIT |
| http-body-util | 0.1.3 | MIT |
| httparse | 1.10.1 | MIT OR Apache-2.0 |
| httpdate | 1.0.3 | MIT OR Apache-2.0 |
| hyper | 1.10.1 | MIT |
| hyper-rustls | 0.27.9 | Apache-2.0 OR ISC OR MIT |
| hyper-tls | 0.6.0 | MIT/Apache-2.0 |
| hyper-util | 0.1.20 | MIT |
| iana-time-zone | 0.1.65 | MIT OR Apache-2.0 |
| iana-time-zone-haiku | 0.1.2 | MIT OR Apache-2.0 |
| ico | 0.5.0 | MIT |
| icu_collections | 2.2.0 | Unicode-3.0 |
| icu_locale_core | 2.2.0 | Unicode-3.0 |
| icu_normalizer | 2.2.0 | Unicode-3.0 |
| icu_normalizer_data | 2.2.0 | Unicode-3.0 |
| icu_properties | 2.2.0 | Unicode-3.0 |
| icu_properties_data | 2.2.0 | Unicode-3.0 |
| icu_provider | 2.2.0 | Unicode-3.0 |
| ident_case | 1.0.1 | MIT/Apache-2.0 |
| idna | 1.1.0 | MIT OR Apache-2.0 |
| idna_adapter | 1.2.2 | Apache-2.0 OR MIT |
| image | 0.25.10 | MIT OR Apache-2.0 |
| indexmap | 1.9.3 | Apache-2.0 OR MIT |
| indexmap | 2.14.0 | Apache-2.0 OR MIT |
| infer | 0.19.0 | MIT |
| ipnet | 2.12.0 | MIT OR Apache-2.0 |
| is-docker | 0.2.0 | MIT |
| is-wsl | 0.4.0 | MIT |
| itoa | 1.0.18 | MIT OR Apache-2.0 |
| javascriptcore-rs | 1.1.2 | MIT |
| javascriptcore-rs-sys | 1.1.1 | MIT |
| jni | 0.21.1 | MIT/Apache-2.0 |
| jni-sys | 0.3.1 | MIT OR Apache-2.0 |
| jni-sys | 0.4.1 | MIT OR Apache-2.0 |
| jni-sys-macros | 0.4.1 | MIT OR Apache-2.0 |
| js-sys | 0.3.103 | MIT OR Apache-2.0 |
| json-patch | 3.0.1 | MIT/Apache-2.0 |
| jsonptr | 0.6.3 | MIT OR Apache-2.0 |
| keyboard-types | 0.7.0 | MIT OR Apache-2.0 |
| libappindicator | 0.9.0 | Apache-2.0 OR MIT |
| libappindicator-sys | 0.9.0 | Apache-2.0 OR MIT |
| libc | 0.2.186 | MIT OR Apache-2.0 |
| libdbus-sys | 0.2.7 | Apache-2.0/MIT |
| libloading | 0.7.4 | ISC |
| libredox | 0.1.17 | MIT |
| linux-raw-sys | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| litemap | 0.8.2 | Unicode-3.0 |
| lock_api | 0.4.14 | MIT OR Apache-2.0 |
| log | 0.4.33 | MIT OR Apache-2.0 |
| mac-notification-sys | 0.6.15 | MIT/Apache-2.0 |
| markup5ever | 0.38.0 | MIT OR Apache-2.0 |
| memchr | 2.8.2 | Unlicense OR MIT |
| memoffset | 0.9.1 | MIT |
| mime | 0.3.17 | MIT OR Apache-2.0 |
| miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 |
| mio | 1.2.1 | MIT |
| moxcms | 0.8.1 | BSD-3-Clause OR Apache-2.0 |
| muda | 0.19.3 | Apache-2.0 OR MIT |
| native-tls | 0.2.18 | MIT OR Apache-2.0 |
| ndk | 0.9.0 | MIT OR Apache-2.0 |
| ndk-sys | 0.6.0+11769913 | MIT OR Apache-2.0 |
| new_debug_unreachable | 1.0.6 | MIT |
| notify-rust | 4.18.0 | MIT OR Apache-2.0 |
| num-conv | 0.2.2 | MIT OR Apache-2.0 |
| num-traits | 0.2.19 | MIT OR Apache-2.0 |
| num_enum | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| num_enum_derive | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| objc2 | 0.6.4 | MIT |
| objc2-app-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-cloud-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-data | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-foundation | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-graphics | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-image | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-location | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-text | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-encode | 4.1.0 | MIT |
| objc2-exception-helper | 0.1.1 | Zlib OR Apache-2.0 OR MIT |
| objc2-foundation | 0.3.2 | MIT |
| objc2-io-surface | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-quartz-core | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-ui-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-user-notifications | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-web-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| once_cell | 1.21.4 | MIT OR Apache-2.0 |
| open | 5.3.6 | MIT |
| openssl | 0.10.81 | Apache-2.0 |
| openssl-macros | 0.1.1 | MIT/Apache-2.0 |
| openssl-probe | 0.2.1 | MIT OR Apache-2.0 |
| openssl-sys | 0.9.117 | MIT |
| option-ext | 0.2.0 | MPL-2.0 |
| ordered-stream | 0.2.0 | MIT OR Apache-2.0 |
| os_pipe | 1.2.3 | MIT |
| pango | 0.18.3 | MIT |
| pango-sys | 0.18.0 | MIT |
| parking | 2.2.1 | Apache-2.0 OR MIT |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 |
| phf | 0.13.1 | MIT |
| phf_codegen | 0.13.1 | MIT |
| phf_generator | 0.13.1 | MIT |
| phf_macros | 0.13.1 | MIT |
| phf_shared | 0.13.1 | MIT |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT |
| piper | 0.2.5 | MIT OR Apache-2.0 |
| pkg-config | 0.3.33 | MIT OR Apache-2.0 |
| plist | 1.9.0 | MIT |
| png | 0.17.16 | MIT OR Apache-2.0 |
| png | 0.18.1 | MIT OR Apache-2.0 |
| polling | 3.11.0 | Apache-2.0 OR MIT |
| potential_utf | 0.1.5 | Unicode-3.0 |
| powerfmt | 0.2.0 | MIT OR Apache-2.0 |
| ppv-lite86 | 0.2.21 | MIT OR Apache-2.0 |
| precomputed-hash | 0.1.1 | MIT |
| proc-macro-crate | 1.3.1 | MIT OR Apache-2.0 |
| proc-macro-crate | 2.0.2 | MIT OR Apache-2.0 |
| proc-macro-crate | 3.5.0 | MIT OR Apache-2.0 |
| proc-macro-error | 1.0.4 | MIT OR Apache-2.0 |
| proc-macro-error-attr | 1.0.4 | MIT OR Apache-2.0 |
| proc-macro2 | 1.0.106 | MIT OR Apache-2.0 |
| pxfm | 0.1.29 | BSD-3-Clause OR Apache-2.0 |
| quick-error | 2.0.1 | MIT/Apache-2.0 |
| quick-xml | 0.39.4 | MIT |
| quick-xml | 0.37.5 | MIT |
| quote | 1.0.46 | MIT OR Apache-2.0 |
| r-efi | 5.3.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later |
| r-efi | 6.0.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later |
| rand | 0.9.4 | MIT OR Apache-2.0 |
| rand | 0.8.6 | MIT OR Apache-2.0 |
| rand_chacha | 0.9.0 | MIT OR Apache-2.0 |
| rand_chacha | 0.3.1 | MIT OR Apache-2.0 |
| rand_core | 0.9.5 | MIT OR Apache-2.0 |
| rand_core | 0.6.4 | MIT OR Apache-2.0 |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib |
| redox_syscall | 0.5.18 | MIT |
| redox_users | 0.5.2 | MIT |
| redox_users | 0.4.6 | MIT |
| ref-cast | 1.0.25 | MIT OR Apache-2.0 |
| ref-cast-impl | 1.0.25 | MIT OR Apache-2.0 |
| regex | 1.12.4 | MIT OR Apache-2.0 |
| regex-automata | 0.4.14 | MIT OR Apache-2.0 |
| regex-syntax | 0.8.11 | MIT OR Apache-2.0 |
| reqwest | 0.12.28 | MIT OR Apache-2.0 |
| reqwest | 0.13.4 | MIT OR Apache-2.0 |
| rfd | 0.16.0 | MIT |
| ring | 0.17.14 | Apache-2.0 AND ISC |
| rustc-hash | 2.1.2 | Apache-2.0 OR MIT |
| rustc_version | 0.4.1 | MIT OR Apache-2.0 |
| rustix | 1.1.4 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| rustls | 0.23.41 | Apache-2.0 OR ISC OR MIT |
| rustls-pki-types | 1.14.1 | MIT OR Apache-2.0 |
| rustls-webpki | 0.103.13 | ISC |
| rustversion | 1.0.22 | MIT OR Apache-2.0 |
| ryu | 1.0.23 | Apache-2.0 OR BSL-1.0 |
| same-file | 1.0.6 | Unlicense/MIT |
| schannel | 0.1.29 | MIT |
| schemars | 1.2.1 | MIT |
| schemars | 0.9.0 | MIT |
| schemars | 0.8.22 | MIT |
| schemars_derive | 0.8.22 | MIT |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 |
| security-framework | 3.7.0 | MIT OR Apache-2.0 |
| security-framework-sys | 2.17.0 | MIT OR Apache-2.0 |
| selectors | 0.36.1 | MPL-2.0 |
| semver | 1.0.28 | MIT OR Apache-2.0 |
| serde | 1.0.228 | MIT OR Apache-2.0 |
| serde-untagged | 0.1.9 | MIT OR Apache-2.0 |
| serde_core | 1.0.228 | MIT OR Apache-2.0 |
| serde_derive | 1.0.228 | MIT OR Apache-2.0 |
| serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 |
| serde_json | 1.0.150 | MIT OR Apache-2.0 |
| serde_repr | 0.1.20 | MIT OR Apache-2.0 |
| serde_spanned | 1.1.1 | MIT OR Apache-2.0 |
| serde_spanned | 0.6.9 | MIT OR Apache-2.0 |
| serde_urlencoded | 0.7.1 | MIT/Apache-2.0 |
| serde_with | 3.21.0 | MIT OR Apache-2.0 |
| serde_with_macros | 3.21.0 | MIT OR Apache-2.0 |
| serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 |
| serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 |
| servo_arc | 0.4.3 | MIT OR Apache-2.0 |
| sha2 | 0.10.9 | MIT OR Apache-2.0 |
| shared_child | 1.1.1 | MIT |
| shlex | 2.0.1 | MIT OR Apache-2.0 |
| sigchld | 0.2.4 | MIT |
| signal-hook | 0.3.18 | Apache-2.0/MIT |
| signal-hook-registry | 1.4.8 | MIT OR Apache-2.0 |
| simd-adler32 | 0.3.9 | MIT |
| siphasher | 1.0.3 | MIT/Apache-2.0 |
| slab | 0.4.12 | MIT |
| smallvec | 1.15.2 | MIT OR Apache-2.0 |
| socket2 | 0.6.4 | MIT OR Apache-2.0 |
| softbuffer | 0.4.8 | MIT OR Apache-2.0 |
| soup3 | 0.5.0 | MIT |
| soup3-sys | 0.5.0 | MIT |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 |
| string_cache | 0.9.0 | MIT OR Apache-2.0 |
| string_cache_codegen | 0.6.1 | MIT OR Apache-2.0 |
| strsim | 0.11.1 | MIT |
| subtle | 2.6.1 | BSD-3-Clause |
| swift-rs | 1.0.7 | MIT OR Apache-2.0 |
| syn | 2.0.118 | MIT OR Apache-2.0 |
| syn | 1.0.109 | MIT OR Apache-2.0 |
| sync_wrapper | 1.0.2 | Apache-2.0 |
| synstructure | 0.13.2 | MIT |
| system-configuration | 0.7.0 | MIT OR Apache-2.0 |
| system-configuration-sys | 0.6.0 | MIT OR Apache-2.0 |
| system-deps | 6.2.2 | MIT OR Apache-2.0 |
| tao | 0.35.3 | Apache-2.0 |
| tao-macros | 0.1.3 | MIT OR Apache-2.0 |
| target-lexicon | 0.12.16 | Apache-2.0 WITH LLVM-exception |
| tauri | 2.11.3 | Apache-2.0 OR MIT |
| tauri-build | 2.6.3 | Apache-2.0 OR MIT |
| tauri-codegen | 2.6.3 | Apache-2.0 OR MIT |
| tauri-macros | 2.6.3 | Apache-2.0 OR MIT |
| tauri-plugin | 2.6.3 | Apache-2.0 OR MIT |
| tauri-plugin-dialog | 2.7.1 | Apache-2.0 OR MIT |
| tauri-plugin-fs | 2.5.1 | Apache-2.0 OR MIT |
| tauri-plugin-notification | 2.3.3 | Apache-2.0 OR MIT |
| tauri-plugin-opener | 2.5.4 | Apache-2.0 OR MIT |
| tauri-plugin-shell | 2.3.5 | Apache-2.0 OR MIT |
| tauri-plugin-single-instance | 2.4.2 | Apache-2.0 OR MIT |
| tauri-runtime | 2.11.3 | Apache-2.0 OR MIT |
| tauri-runtime-wry | 2.11.3 | Apache-2.0 OR MIT |
| tauri-utils | 2.9.3 | Apache-2.0 OR MIT |
| tauri-winres | 0.3.6 | MIT |
| tauri-winrt-notification | 0.7.2 | MIT OR Apache-2.0 |
| tempfile | 3.27.0 | MIT OR Apache-2.0 |
| tendril | 0.5.0 | MIT OR Apache-2.0 |
| thiserror | 2.0.18 | MIT OR Apache-2.0 |
| thiserror | 1.0.69 | MIT OR Apache-2.0 |
| thiserror-impl | 1.0.69 | MIT OR Apache-2.0 |
| thiserror-impl | 2.0.18 | MIT OR Apache-2.0 |
| tiff | 0.11.3 | MIT |
| time | 0.3.51 | MIT OR Apache-2.0 |
| time-core | 0.1.9 | MIT OR Apache-2.0 |
| time-macros | 0.2.30 | MIT OR Apache-2.0 |
| tiny_http | 0.12.0 | MIT OR Apache-2.0 |
| tinystr | 0.8.3 | Unicode-3.0 |
| tinyvec | 1.11.0 | Zlib OR Apache-2.0 OR MIT |
| tinyvec_macros | 0.1.1 | MIT OR Apache-2.0 OR Zlib |
| tokio | 1.52.3 | MIT |
| tokio-macros | 2.7.0 | MIT |
| tokio-native-tls | 0.3.1 | MIT |
| tokio-rustls | 0.26.4 | MIT OR Apache-2.0 |
| tokio-util | 0.7.18 | MIT |
| toml | 0.8.2 | MIT OR Apache-2.0 |
| toml | 0.9.12+spec-1.1.0 | MIT OR Apache-2.0 |
| toml | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_datetime | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_datetime | 0.6.3 | MIT OR Apache-2.0 |
| toml_datetime | 0.7.5+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_edit | 0.25.12+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_edit | 0.20.2 | MIT OR Apache-2.0 |
| toml_edit | 0.19.15 | MIT OR Apache-2.0 |
| toml_parser | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_writer | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| tower | 0.5.3 | MIT |
| tower-http | 0.6.11 | MIT |
| tower-layer | 0.3.3 | MIT |
| tower-service | 0.3.3 | MIT |
| tracing | 0.1.44 | MIT |
| tracing-attributes | 0.1.31 | MIT |
| tracing-core | 0.1.36 | MIT |
| tray-icon | 0.24.1 | MIT OR Apache-2.0 |
| try-lock | 0.2.5 | MIT |
| typeid | 1.0.3 | MIT OR Apache-2.0 |
| typenum | 1.20.1 | MIT OR Apache-2.0 |
| uds_windows | 1.2.1 | MIT |
| unic-char-property | 0.9.0 | MIT/Apache-2.0 |
| unic-char-range | 0.9.0 | MIT/Apache-2.0 |
| unic-common | 0.9.0 | MIT/Apache-2.0 |
| unic-ucd-ident | 0.9.0 | MIT/Apache-2.0 |
| unic-ucd-version | 0.9.0 | MIT/Apache-2.0 |
| unicode-ident | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-segmentation | 1.13.3 | MIT OR Apache-2.0 |
| untrusted | 0.9.0 | ISC |
| url | 2.5.8 | MIT OR Apache-2.0 |
| urlpattern | 0.3.0 | MIT |
| utf-8 | 0.7.6 | MIT OR Apache-2.0 |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT |
| uuid | 1.23.4 | Apache-2.0 OR MIT |
| vcpkg | 0.2.15 | MIT/Apache-2.0 |
| version-compare | 0.2.1 | MIT |
| version_check | 0.9.5 | MIT/Apache-2.0 |
| vswhom | 0.1.0 | MIT |
| vswhom-sys | 0.1.3 | MIT |
| walkdir | 2.5.0 | Unlicense/MIT |
| want | 0.3.1 | MIT |
| wasi | 0.11.1+wasi-snapshot-preview1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasip2 | 1.0.4+wasi-0.2.12 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasm-bindgen | 0.2.126 | MIT OR Apache-2.0 |
| wasm-bindgen-futures | 0.4.76 | MIT OR Apache-2.0 |
| wasm-bindgen-macro | 0.2.126 | MIT OR Apache-2.0 |
| wasm-bindgen-macro-support | 0.2.126 | MIT OR Apache-2.0 |
| wasm-bindgen-shared | 0.2.126 | MIT OR Apache-2.0 |
| wasm-streams | 0.5.0 | MIT OR Apache-2.0 |
| web-sys | 0.3.103 | MIT OR Apache-2.0 |
| web_atoms | 0.2.5 | MIT OR Apache-2.0 |
| webkit2gtk | 2.0.2 | MIT |
| webkit2gtk-sys | 2.0.2 | MIT |
| webview2-com | 0.38.2 | MIT |
| webview2-com-macros | 0.8.1 | MIT |
| webview2-com-sys | 0.38.2 | MIT |
| weezl | 0.1.12 | MIT OR Apache-2.0 |
| winapi | 0.3.9 | MIT/Apache-2.0 |
| winapi-i686-pc-windows-gnu | 0.4.0 | MIT/Apache-2.0 |
| winapi-util | 0.1.11 | Unlicense OR MIT |
| winapi-x86_64-pc-windows-gnu | 0.4.0 | MIT/Apache-2.0 |
| window-vibrancy | 0.6.0 | Apache-2.0 OR MIT |
| windows | 0.61.3 | MIT OR Apache-2.0 |
| windows-collections | 0.2.0 | MIT OR Apache-2.0 |
| windows-core | 0.62.2 | MIT OR Apache-2.0 |
| windows-core | 0.61.2 | MIT OR Apache-2.0 |
| windows-future | 0.2.1 | MIT OR Apache-2.0 |
| windows-implement | 0.60.2 | MIT OR Apache-2.0 |
| windows-interface | 0.59.3 | MIT OR Apache-2.0 |
| windows-link | 0.2.1 | MIT OR Apache-2.0 |
| windows-link | 0.1.3 | MIT OR Apache-2.0 |
| windows-numerics | 0.2.0 | MIT OR Apache-2.0 |
| windows-registry | 0.6.1 | MIT OR Apache-2.0 |
| windows-result | 0.3.4 | MIT OR Apache-2.0 |
| windows-result | 0.4.1 | MIT OR Apache-2.0 |
| windows-strings | 0.5.1 | MIT OR Apache-2.0 |
| windows-strings | 0.4.2 | MIT OR Apache-2.0 |
| windows-sys | 0.60.2 | MIT OR Apache-2.0 |
| windows-sys | 0.59.0 | MIT OR Apache-2.0 |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 |
| windows-sys | 0.48.0 | MIT OR Apache-2.0 |
| windows-sys | 0.45.0 | MIT OR Apache-2.0 |
| windows-sys | 0.52.0 | MIT OR Apache-2.0 |
| windows-targets | 0.48.5 | MIT OR Apache-2.0 |
| windows-targets | 0.52.6 | MIT OR Apache-2.0 |
| windows-targets | 0.53.5 | MIT OR Apache-2.0 |
| windows-targets | 0.42.2 | MIT OR Apache-2.0 |
| windows-threading | 0.1.0 | MIT OR Apache-2.0 |
| windows-version | 0.1.7 | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | 0.42.2 | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | 0.53.1 | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | 0.48.5 | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | 0.52.6 | MIT OR Apache-2.0 |
| windows_aarch64_msvc | 0.53.1 | MIT OR Apache-2.0 |
| windows_aarch64_msvc | 0.52.6 | MIT OR Apache-2.0 |
| windows_aarch64_msvc | 0.42.2 | MIT OR Apache-2.0 |
| windows_aarch64_msvc | 0.48.5 | MIT OR Apache-2.0 |
| windows_i686_gnu | 0.52.6 | MIT OR Apache-2.0 |
| windows_i686_gnu | 0.53.1 | MIT OR Apache-2.0 |
| windows_i686_gnu | 0.42.2 | MIT OR Apache-2.0 |
| windows_i686_gnu | 0.48.5 | MIT OR Apache-2.0 |
| windows_i686_gnullvm | 0.53.1 | MIT OR Apache-2.0 |
| windows_i686_gnullvm | 0.52.6 | MIT OR Apache-2.0 |
| windows_i686_msvc | 0.48.5 | MIT OR Apache-2.0 |
| windows_i686_msvc | 0.52.6 | MIT OR Apache-2.0 |
| windows_i686_msvc | 0.53.1 | MIT OR Apache-2.0 |
| windows_i686_msvc | 0.42.2 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.53.1 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.42.2 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.48.5 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.52.6 | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | 0.42.2 | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | 0.53.1 | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | 0.48.5 | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | 0.52.6 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.52.6 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.42.2 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.48.5 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.53.1 | MIT OR Apache-2.0 |
| winnow | 1.0.3 | MIT |
| winnow | 0.7.15 | MIT |
| winnow | 0.5.40 | MIT |
| winreg | 0.55.0 | MIT |
| wit-bindgen | 0.57.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| writeable | 0.6.3 | Unicode-3.0 |
| wry | 0.55.1 | Apache-2.0 OR MIT |
| x11 | 2.21.0 | MIT |
| x11-dl | 2.21.0 | MIT |
| x11rb | 0.13.2 | MIT OR Apache-2.0 |
| x11rb-protocol | 0.13.2 | MIT OR Apache-2.0 |
| yoke | 0.8.3 | Unicode-3.0 |
| yoke-derive | 0.8.2 | Unicode-3.0 |
| zbus | 5.16.0 | MIT |
| zbus_macros | 5.16.0 | MIT |
| zbus_names | 4.3.2 | MIT |
| zerocopy | 0.8.52 | BSD-2-Clause OR Apache-2.0 OR MIT |
| zerocopy-derive | 0.8.52 | BSD-2-Clause OR Apache-2.0 OR MIT |
| zerofrom | 0.1.8 | Unicode-3.0 |
| zerofrom-derive | 0.1.7 | Unicode-3.0 |
| zeroize | 1.9.0 | Apache-2.0 OR MIT |
| zerotrie | 0.2.4 | Unicode-3.0 |
| zerovec | 0.11.6 | Unicode-3.0 |
| zerovec-derive | 0.11.3 | Unicode-3.0 |
| zmij | 1.0.21 | MIT |
| zune-core | 0.5.1 | MIT OR Apache-2.0 OR Zlib |
| zune-jpeg | 0.5.15 | MIT OR Apache-2.0 OR Zlib |
| zvariant | 5.12.0 | MIT |
| zvariant_derive | 5.12.0 | MIT |
| zvariant_utils | 3.4.0 | MIT |

_Total: 559 crates._

## JavaScript / frontend dependencies

| Package | Version |
|---|---|
| `@tauri-apps/api` | ^2.1.1 |
| `@tauri-apps/plugin-dialog` | ^2.0.1 |
| `@tauri-apps/plugin-notification` | ^2.0.1 |
| `@tauri-apps/plugin-opener` | ^2.2.5 |
| `clsx` | ^2.1.1 |
| `framer-motion` | ^11.11.17 |
| `react` | ^18.3.1 |
| `react-dom` | ^18.3.1 |
| `zustand` | ^5.0.1 |

> These npm packages are MIT / Apache-2.0 / ISC licensed; each package's notice is on npmjs.com.

---

## MIT License (applies to the many MIT-licensed crates above)

```
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

---

## Apache License 2.0 (applies to the Apache-2.0-licensed crates above)

```
Apache License
                        Version 2.0, January 2004
                     https://www.apache.org/licenses/LICENSE-2.0

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright [yyyy] [name of copyright owner]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

Other licenses present above (BSD-2/3-Clause, ISC, Zlib, MPL-2.0, Unicode-3.0, BSL-1.0,
0BSD, Unlicense, CC0-1.0) are permissive; each crate's full notice ships with its source
on crates.io and in its linked repository.
