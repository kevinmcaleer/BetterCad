# Library files from outside KiCad's own libraries, used in the import tests

Each is here only so the importer is tested on real files from other sources, in the formats they ship.

| File | From | Licence |
| --- | --- | --- |
| `SparkFun-LED.kicad_sym` | One symbol (APA102_2020_6Pin) cut from `symbols/SparkFun-LED.kicad_sym`, https://github.com/sparkfun/SparkFun-KiCad-Libraries (KiCad 10 format) | CC-BY 4.0, SparkFun Electronics |
| `Espressif.kicad_sym` | One symbol (ESP32-C3-MINI-1) cut from `symbols/Espressif.kicad_sym`, https://github.com/espressif/kicad-libraries | CC-BY-SA 4.0 with the KiCad libraries exception, Espressif Systems |
| `ESP32-C3-MINI-1.kicad_mod` | `footprints/Espressif.pretty/ESP32-C3-MINI-1.kicad_mod`, same repository, unchanged | CC-BY-SA 4.0 with the KiCad libraries exception, Espressif Systems |
| `SOT-23-3.kicad_mod` | `digikey-footprints.pretty/SOT-23-3.kicad_mod`, https://github.com/Digi-Key/digikey-kicad-library, unchanged (KiCad 5 format) | CC-BY-SA 4.0 with an exception, Digi-Key |

The two cut files were written back out by BetterCad's own s-expression writer, so their spacing differs from the
originals; nothing else was changed.
