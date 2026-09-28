"""FlowAId's PageIndex service: indexes PDFs into hierarchical trees with the pinned PageIndex SDK
(local mode) and serves each workspace's trees and page text to the FlowAId worker.

Protocol version 1 (``X-FlowAId-Protocol: 1``). Everything is private to the Compose network or
loopback and authenticated with a shared bearer token; see ``server.py``.
"""

PROTOCOL_VERSION = "1"
SERVICE_VERSION = "0.1.0"
#: the SDK release this service is built and tested against (requirements.lock pins it)
PINNED_SDK = "0.2.20"
