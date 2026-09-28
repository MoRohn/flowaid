# Third-party software in the PageIndex service

The image installs exactly the packages pinned in `requirements.lock` (hash-checked). The
direct dependency is **pageindex 0.2.20** by Vectify AI, MIT licensed
(https://github.com/VectifyAI/PageIndex), used as a library without modification. Its license
text ships inside the installed package; the table lists every pinned package and the license
its metadata declares (generated from the installed distributions; no GPL, LGPL or AGPL
licenses are present).

| package                   | version     | license                                       |
| ------------------------- | ----------- | --------------------------------------------- |
| aiohappyeyeballs          | 2.7.1       | Python Software Foundation License            |
| aiohttp                   | 3.14.3      | Apache-2.0 AND MIT                            |
| aiosignal                 | 1.4.0       | Apache Software License                       |
| annotated-types           | 0.8.0       | MIT                                           |
| anyio                     | 4.15.1      | MIT                                           |
| attrs                     | 26.1.0      | MIT                                           |
| boto3                     | 1.43.103    | Apache-2.0                                    |
| botocore                  | 1.43.103    | Apache-2.0                                    |
| certifi                   | 2026.7.22   | Mozilla Public License 2.0 (MPL 2.0)          |
| cffi                      | 2.1.1       | MIT-0                                         |
| charset-normalizer        | 3.5.1       | MIT                                           |
| click                     | 8.5.0       | BSD-3-Clause                                  |
| colorama                  | 0.4.6       | BSD-3-Clause (installed on Windows only)      |
| cryptography              | 50.0.1      | Apache-2.0 OR BSD-3-Clause                    |
| distro                    | 1.9.0       | Apache Software License                       |
| fastuuid                  | 0.14.0      | BSD License                                   |
| filelock                  | 4.0.5       | MIT                                           |
| frozenlist                | 1.8.0       | Apache-2.0                                    |
| fsspec                    | 2026.9.0    | BSD-3-Clause                                  |
| griffelib                 | 2.3.0       | ISC                                           |
| h11                       | 0.16.0      | MIT License                                   |
| h2                        | 4.4.1       | MIT                                           |
| hf-xet                    | 1.6.0       | Apache-2.0                                    |
| hpack                     | 4.2.0       | MIT                                           |
| httpcore                  | 1.0.9       | BSD-3-Clause                                  |
| httpcore2                 | 2.13.1      | BSD-3-Clause                                  |
| httpx                     | 0.28.1      | BSD License                                   |
| httpx2                    | 2.13.1      | BSD-3-Clause                                  |
| httpx2-jsfetch            | 1.0         | not installed (WebAssembly platforms only)    |
| huggingface-hub           | 1.33.0      | Apache Software License                       |
| hyperframe                | 6.1.0       | MIT License                                   |
| idna                      | 3.20        | BSD-3-Clause                                  |
| importlib-metadata        | 8.9.0       | Apache-2.0                                    |
| jinja2                    | 3.1.6       | BSD License                                   |
| jiter                     | 0.17.0      | MIT                                           |
| jmespath                  | 1.1.0       | MIT License                                   |
| jsonschema                | 4.26.0      | MIT                                           |
| jsonschema-specifications | 2025.9.1    | MIT                                           |
| litellm                   | 1.103.0     | MIT                                           |
| markupsafe                | 3.0.3       | BSD-3-Clause                                  |
| mcp                       | 2.2.0       | MIT License                                   |
| mcp-types                 | 2.2.0       | MIT License                                   |
| multidict                 | 6.9.1       | Apache License 2.0                            |
| openai                    | 2.54.0      | Apache Software License                       |
| openai-agents             | 0.20.0      | MIT                                           |
| opentelemetry-api         | 1.45.0      | Apache-2.0                                    |
| packaging                 | 26.3        | Apache-2.0 OR BSD-2-Clause                    |
| pageindex                 | 0.2.20      | MIT License                                   |
| pillow                    | 12.3.0      | MIT-CMU                                       |
| propcache                 | 0.5.4       | Apache-2.0                                    |
| pycparser                 | 3.0         | BSD-3-Clause                                  |
| pydantic                  | 2.13.5      | MIT                                           |
| pydantic-core             | 2.46.5      | MIT                                           |
| pydantic-settings         | 2.15.0      | MIT                                           |
| pyjwt                     | 2.15.1      | MIT                                           |
| pypdf2                    | 3.0.1       | BSD License                                   |
| pypdfium2                 | 5.13.0      | BSD-3-Clause, Apache-2.0, dependency licenses |
| python-dateutil           | 2.9.0.post0 | BSD License; Apache Software License          |
| python-dotenv             | 1.2.3       | BSD-3-Clause                                  |
| python-multipart          | 0.0.32      | Apache-2.0                                    |
| pywin32                   | 312         | PSF-2.0 (installed on Windows only)           |
| pyyaml                    | 6.0.3       | MIT License                                   |
| referencing               | 0.37.0      | MIT                                           |
| regex                     | 2026.9.10   | Apache-2.0 AND CNRI-Python                    |
| requests                  | 2.34.2      | Apache Software License                       |
| rpds-py                   | 2026.6.3    | MIT                                           |
| s3transfer                | 0.19.2      | Apache Software License                       |
| six                       | 1.17.0      | MIT License                                   |
| sniffio                   | 1.3.1       | MIT License; Apache Software License          |
| sortedcontainers          | 2.4.0       | Apache Software License                       |
| sse-starlette             | 3.5.0       | BSD-3-Clause                                  |
| starlette                 | 1.7.0       | BSD-3-Clause                                  |
| tiktoken                  | 0.14.0      | MIT License                                   |
| tokenizers                | 0.23.2      | Apache Software License                       |
| tqdm                      | 4.70.1      | MPL-2.0 AND MIT                               |
| truststore                | 0.10.4      | MIT                                           |
| typing-extensions         | 4.16.0      | PSF-2.0                                       |
| typing-inspection         | 0.4.4       | MIT                                           |
| urllib3                   | 2.8.0       | MIT                                           |
| uvicorn                   | 0.54.0      | BSD-3-Clause                                  |
| websockets                | 16.1.1      | BSD-3-Clause                                  |
| yarl                      | 1.25.1      | Apache-2.0                                    |
| zipp                      | 4.1.0       | MIT                                           |
