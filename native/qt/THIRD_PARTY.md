# Native dependencies

The native sources include the unmodified single header from
[nlohmann/json 3.11.2](https://github.com/nlohmann/json/tree/v3.11.2), under the
MIT license. The full license is in `third_party/nlohmann/LICENSE.MIT` and is
included in the generated native package as `LICENSE.nlohmann-json`.

The bridge builds against the Qt 6.9.2 Core, Gui and Widgets SDK. The generated
package contains no Qt DLLs, plugins, product executables or product data.
At runtime the loader verifies the supported product's existing Qt modules
before attaching the bridge. Obtain the SDK and use it under its applicable
[Qt license](https://www.qt.io/licensing/).

`compatibility.json` contains product-binary compatibility fingerprints. These
are checked in addition to the package manifest's hashes of the newly built
loader and bridge. A different product or Qt binary requires a reviewed
compatibility binding and validation.
