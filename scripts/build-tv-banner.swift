#!/usr/bin/env swift

// Renders assets/brand/kino-banner.svg into the Android TV launcher banner.
//
// Android asks for the banner as one raster per density bucket rather than a
// vector, and the artwork carries shading a vector drawable cannot reproduce:
// the icon's glass highlight and the shadow that lifts a near black tile off a
// near black background. Rendering every bucket from the same source keeps them
// identical apart from resolution.

import AppKit
import Foundation
import WebKit

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = root.appendingPathComponent("assets/brand/kino-banner.svg")
let resources = root.appendingPathComponent("apps/android-tv/app/src/main/res")

// Google's banner ladder: 16:9, 320x180 at xhdpi, scaled by density from there.
let buckets: [(name: String, width: Int, height: Int)] = [
    ("mipmap-mdpi", 160, 90),
    ("mipmap-hdpi", 240, 135),
    ("mipmap-xhdpi", 320, 180),
    ("mipmap-xxhdpi", 480, 270),
    ("mipmap-xxxhdpi", 640, 360),
]

// The web view rasterises the SVG at whatever size its frame is, so the source
// is scaled once per bucket rather than downsampled from a single render.
//
// The markup is inlined rather than pointed at with an img tag. An SVG loaded
// through img renders in secure static mode, which forbids external references,
// so the icon the banner draws would silently come out blank. The page also has
// to load from a file URL for that icon to resolve at all.
let markup = try String(contentsOf: source, encoding: .utf8)
let page = """
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
svg{display:block;width:100vw;height:100vh}</style>
\(markup)
"""

let stage = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("kino-banner-\(ProcessInfo.processInfo.processIdentifier)")
try? FileManager.default.removeItem(at: stage)
try FileManager.default.createDirectory(at: stage, withIntermediateDirectories: true)
for name in ["kino-app-icon.png"] {
    try FileManager.default.copyItem(
        at: source.deletingLastPathComponent().appendingPathComponent(name),
        to: stage.appendingPathComponent(name))
}
let document = stage.appendingPathComponent("index.html")
try page.write(to: document, atomically: true, encoding: .utf8)

final class Renderer: NSObject, WKNavigationDelegate {
    private var view: WKWebView!
    private var done: ((NSImage) -> Void)!

    func render(width: Int, height: Int, then: @escaping (NSImage) -> Void) {
        done = then
        let config = WKWebViewConfiguration()
        view = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
        view.navigationDelegate = self
        view.loadFileURL(document, allowingReadAccessTo: stage)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // The image decodes after the document finishes, so snapshot on the next
        // turn of the run loop rather than immediately.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            webView.takeSnapshot(with: nil) { image, error in
                guard let image else {
                    FileHandle.standardError.write("snapshot failed: \(error!)\n".data(using: .utf8)!)
                    exit(1)
                }
                self.done(image)
            }
        }
    }
}

func png(_ image: NSImage, width: Int, height: Int) -> Data {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    image.draw(in: NSRect(x: 0, y: 0, width: width, height: height))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

var remaining = buckets
let renderer = Renderer()

func next() {
    guard let bucket = remaining.first else {
        try? FileManager.default.removeItem(at: stage)
        print("wrote \(buckets.count) banner variants under \(resources.path)")
        exit(0)
    }
    remaining.removeFirst()
    renderer.render(width: bucket.width, height: bucket.height) { image in
        let directory = resources.appendingPathComponent(bucket.name)
        try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("kino_banner.png")
        try! png(image, width: bucket.width, height: bucket.height).write(to: file)
        print("  \(bucket.name)/kino_banner.png  \(bucket.width)x\(bucket.height)")
        next()
    }
}

next()
RunLoop.main.run()
