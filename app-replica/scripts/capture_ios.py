#!/usr/bin/env python3
"""Capture the current Appium session, without navigating or submitting actions."""
import argparse
import base64
import datetime
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server', default='http://127.0.0.1:4725')
    parser.add_argument('--session-file', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--bundle-id', help='Reject UI trees from another or invisible application')
    args = parser.parse_args()
    session = json.loads(args.session_file.read_text())['value']['sessionId']
    def get(endpoint):
        url = f'{args.server.rstrip("/")}/session/{session}/{endpoint}'
        with urllib.request.urlopen(url, timeout=90) as response:
            return json.load(response)['value']
    capture_settings = get('appium/settings')
    source = get('source')
    tree = ET.fromstring(source)
    apps = [node for node in tree.iter() if node.attrib.get('type') == 'XCUIElementTypeApplication']
    if args.bundle_id and not any(node.attrib.get('bundleId') == args.bundle_id and node.attrib.get('visible') != 'false' for node in apps):
        raise ValueError('Expected application is not visible in UI tree; activate it before capture')
    args.output.mkdir(parents=True, exist_ok=False)
    args.output.joinpath('source.xml').write_text(source)
    boxes = [dict(node.attrib) for node in tree.iter() if 'x' in node.attrib]
    args.output.joinpath('elements.json').write_text(json.dumps(boxes, ensure_ascii=False, indent=2))
    screenshot = base64.b64decode(get('screenshot'), validate=True)
    if not screenshot.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Screenshot is not PNG')
    args.output.joinpath('screen.png').write_bytes(screenshot)
    args.output.joinpath('capture.json').write_text(json.dumps({
        'captured_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'screen_pixels': {'width': int.from_bytes(screenshot[16:20], 'big'), 'height': int.from_bytes(screenshot[20:24], 'big')},
        'coordinate_source': 'XCUITest accessibility tree; confirm logical units against device configuration',
        'element_count': len(boxes),
        'automation_settings': capture_settings,
        'tree_boundary': 'Snapshot settings may cap depth/children or omit attributes; consult automation_settings',
        'applications': [{'bundle_id': node.attrib.get('bundleId'), 'visible': node.attrib.get('visible')} for node in apps],
        'temporal_boundary': 'UI tree and screenshot captured sequentially; dynamic content may change',
        'privacy': 'Raw local capture. Review and redact account data before committing.'
    }, ensure_ascii=False, indent=2))
    print(json.dumps({'output': str(args.output), 'elements': len(boxes)}))

if __name__ == '__main__':
    main()
