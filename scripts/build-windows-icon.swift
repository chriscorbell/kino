#!/usr/bin/env swift

// Turns the app icon art into apps/macos-shell/resources/Kino.ico, which the
// Windows build embeds as Kino.exe's icon. Qt's Windows platform plugin gives
// every window the executable's first icon, so this is also the taskbar's.
//
// Windows draws no plate or mask of its own and lays icons out on a 48 pixel
// grid, so the rounded shape keeps a 2 pixel margin at 48 and the same share
// of every other size, snapped to whole pixels so small sizes stay sharp. The
// sizes are the target sizes Microsoft lists for Windows 11's taskbar, Start,
// title bars and context menus at every scale factor; 256 lets Windows only
// ever scale down. Each image is stored as PNG, which Windows reads from an
// .ico at any size.

import AppKit
import CoreGraphics
import Foundation

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = root.appendingPathComponent("assets/brand/kino-app-icon.png")
let output = root.appendingPathComponent("apps/macos-shell/resources/Kino.ico")

let sizes = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]
let marginAt48 = 2.0

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
    let margin = (Double(size) * marginAt48 / 48).rounded()
    let side = Double(size) - 2 * margin
    let context = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    context.draw(art, in: CGRect(x: margin, y: margin, width: side, height: side))

    let image = context.makeImage()!
    let out = NSMutableData()
    let dest = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    CGImageDestinationFinalize(dest)
    return out as Data
}

func le16(_ value: Int) -> Data { withUnsafeBytes(of: UInt16(value).littleEndian) { Data($0) } }
func le32(_ value: Int) -> Data { withUnsafeBytes(of: UInt32(value).littleEndian) { Data($0) } }

// ICONDIR, one 16 byte ICONDIRENTRY per image, then the images. A width or
// height byte of 0 means 256.
let images = sizes.map(render)
var ico = le16(0) + le16(1) + le16(sizes.count)
var offset = 6 + 16 * sizes.count
for (size, png) in zip(sizes, images) {
    ico.append(contentsOf: [UInt8(size % 256), UInt8(size % 256), 0, 0])
    ico += le16(1) + le16(32) + le32(png.count) + le32(offset)
    offset += png.count
}
for png in images { ico += png }
try ico.write(to: output)

print("wrote \(output.path)")
