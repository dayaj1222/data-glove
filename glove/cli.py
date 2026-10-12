"""Command-line entry point."""

import argparse
import sys
from typing import Optional

from glove.transport.udp import UDPTransport
from glove.protocol.simple import SimpleBinaryProtocol
from glove.recognition.stub import StubRecognizer
from glove.recognition.threshold import ThresholdRecognizer
from glove.pipeline.main import Pipeline


def main() -> None:
    parser = argparse.ArgumentParser(description="Data Glove gesture recognition system")
    parser.add_argument("--port", type=int, default=5005, help="UDP port to listen on")
    parser.add_argument("--config", type=str, default="glove.config.default", help="Config module")
    parser.add_argument("--debug", action="store_true", help="Print frames")
    parser.add_argument("--mock", action="store_true", help="Use mock data generator instead of UDP")
    args = parser.parse_args()

    if args.mock:
        from glove.transport.mock import MockTransport
        transport = MockTransport()
    else:
        transport = UDPTransport(port=args.port)

    protocol = SimpleBinaryProtocol()
    
    # Use threshold recognizer with example config if available, else stub
    try:
        from glove.config.gestures import GESTURE_CONFIG
        recognizer = ThresholdRecognizer(GESTURE_CONFIG)
    except ImportError:
        recognizer = StubRecognizer()

    pipeline = Pipeline(
        transport=transport,
        protocol=protocol,
        recognizer=recognizer,
        config_module=args.config,
        debug=args.debug,
    )
    try:
        pipeline.run()
    except KeyboardInterrupt:
        print("\nShutting down...")
        sys.exit(0)


if __name__ == "__main__":
    main()
