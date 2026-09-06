#!/usr/bin/env swift

// Turns the full-bleed app icon art into apps/macos-shell/resources/Kino.icns.
//
// Icon Composer exports art that fills its canvas edge to edge, which is what
// iOS wants. A macOS .icns has to place that art on the Finder and Dock grid
// itself: the shape occupies 824 of a 1024 point canvas, centered, and carries
// the drop shadow the system does not draw for legacy icon resources. The
// numbers below were measured off a stock macOS 26 icon (Notes.app), whose
// shadow spreads 20 points sideways and sits 8 points low at 1024.

import AppKit
import CoreGraphics
import Foundation

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = root.appendingPathComponent("assets/brand/kino-app-icon.png")
let output = root.appendingPathComponent("apps/macos-shell/resources/Kino.icns")

let gridRatio = 824.0 / 1024.0
let shadowBlurAt1024 = 26.0
let shadowOffsetAt1024 = 6.0
let shadowAlpha = 0.28

guard let data = try? Data(contentsOf: source),
    let provider = CGDataProvider(data: data as CFData),
    let art = CGImage(
        pngDataProviderSource: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent
    )
else {
    FileHandle.standardError.write("cannot read \(source.path)\n".data(using: .utf8)!)
    exit(1)
}

func render(_ size: Int) -> Data {
    let canvas = CGFloat(size)
    let scale = canvas / 1024.0
    let art_side = (canvas * gridRatio).rounded()
    let origin = ((canvas - art_side) / 2).rounded()

    let context = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    context.setShadow(
        offset: CGSize(width: 0, height: -shadowOffsetAt1024 * scale),
        blur: shadowBlurAt1024 * scale,
        color: CGColor(red: 0, green: 0, blue: 0, alpha: shadowAlpha))
    context.draw(art, in: CGRect(x: origin, y: origin, width: art_side, height: art_side))

    let image = context.makeImage()!
    let out = NSMutableData()
    let dest = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    CGImageDestinationFinalize(dest)
    return out as Data
}

// iconutil reads an .iconset whose names carry the point size and the scale.
let variants: [(name: String, pixels: Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

let iconset = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("Kino-\(ProcessInfo.processInfo.processIdentifier).iconset")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: iconset) }

var cache: [Int: Data] = [:]
for variant in variants {
    let png = cache[variant.pixels] ?? { let d = render(variant.pixels); cache[variant.pixels] = d; return d }()
    try png.write(to: iconset.appendingPathComponent("\(variant.name).png"))
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", output.path]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else { exit(iconutil.terminationStatus) }

print("wrote \(output.path)")
