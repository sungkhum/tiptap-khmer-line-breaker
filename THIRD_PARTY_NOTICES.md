# Third-Party Notices

This project is released under the MIT License. Its Khmer word-breaking code, spell-check code and dictionaries come from [Aksara](https://github.com/sbbic-khmer/aksara-khmer-word-processor), and [Aksara's notices](https://github.com/sbbic-khmer/aksara-khmer-word-processor/blob/main/THIRD_PARTY_NOTICES.md) record how the dictionaries were built. npm dependencies are not listed here; they ship with their own licenses.

| Component | Used in | License |
|---|---|---|
| [Aksara](https://github.com/sbbic-khmer/aksara-khmer-word-processor) by SBBIC Khmer | `src/lib/`, `public/workers/spell-check-worker.js`, `public/dictionaries/` | MIT |
| [khmerlbdict](https://github.com/silnrsi/khmerlbdict) by SIL NRSI | `public/dictionaries/km_frequency_dictionary.json`, `src/lib/khmer-dictionary-data.ts`, spell-check frequencies | MIT |
| [Unicode CLDR](https://github.com/unicode-org/cldr), through khmerlbdict's `places.txt` | Same as khmerlbdict | Unicode-3.0 |
| [SBBIC](http://www.sbbic.org) Spelling Checker word list (`km_KH.dic`) | `public/dictionaries/km_symspell_dictionary.txt` | MIT, as described below |
| Multiple-spellings list by SBBIC (Nathan Wells) | `public/dictionaries/khmer-multiple-spellings.txt` | MIT |
| [node-symspell-new](https://github.com/Ravikumar-Pawar/node-symspell-new) | `public/lib/symspell-browser.js` | MIT |
| [SymSpell](https://github.com/wolfgarbe/SymSpell) by Wolf Garbe | `public/lib/symspell-browser.js` | MIT |

SIL's [README](https://github.com/silnrsi/khmerlbdict/blob/master/README.md) describes the upstream sources of khmerlbdict. Those sources remain subject to any terms set by their owners.

## SBBIC Spelling Checker word list

The SBBIC Spelling Checker package is distributed under GPLv3. Its license file names SBBIC as the author and says the checker was based on the Chuon Nath and Headley dictionaries and on KhmerOS's and SBBIC's spelling wordlists. SBBIC also makes this word list available under the MIT License, and that is the license that applies to it here.

## License texts

### MIT License

This license applies to the following components:

```
Aksara, including the SBBIC word list and multiple-spellings list:
                    Copyright (c) 2025 SBBIC Khmer
khmerlbdict:        Copyright (c) 2015 SIL NRSI
node-symspell-new:  Copyright (c) 2019 Mathieu Triay
                    (with 2024 enhancements by Ravikumar Pawar)
SymSpell:           Copyright (c) 2018 Wolf Garbe
```

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Unicode License v3

This license applies to the Unicode CLDR data included through khmerlbdict.

```
COPYRIGHT AND PERMISSION NOTICE

Copyright © 2001–2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0
```
