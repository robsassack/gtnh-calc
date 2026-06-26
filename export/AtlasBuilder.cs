using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;
using SixLabors.ImageSharp.Formats.Webp;

namespace Source
{
    public class AtlasBuilder : IDisposable
    {
        private readonly ZipArchive archive;
        private readonly string savePath;
        
        public AtlasBuilder(string imagesArchivePath, string savePath)
        {
            archive = new ZipArchive(File.OpenRead(imagesArchivePath), ZipArchiveMode.Read);
            this.savePath = savePath;
        }

        private Image<Rgba32> LoadImageFromArchive(string path)
        {
            var entry = archive.GetEntry(path);
            if (entry == null)
            {
                path = path.Substring(0, path.Length - 4);
                foreach (var iEntry in archive.Entries)
                {
                    if (iEntry.FullName.StartsWith(path, StringComparison.Ordinal))
                    {
                        entry = iEntry;
                        break;
                    }
                }
            }

            if (entry == null)
            {
                Console.WriteLine("Unable to find archive entry for " + path);
                return null;
            }

            using var stream = entry.Open();
            return Image.Load<Rgba32>(stream);
        }
        
        public string BuildAtlas(List<string> iconsPaths)
        {
            Console.WriteLine($"Starting atlas creation with {iconsPaths.Count} icons...");
            
            // Build the final 32px atlas directly. Keeping both a 64px atlas and
            // a resized clone at the same time can add several GB of peak memory.
            var iconsCount = iconsPaths.Count;
            var requiredHeight = (iconsCount - 1) / (1 << IconAtlas.DimensionBits) + 1;
            var outputImageSize = IconAtlas.ImageSize / 2;
            var width = (1 << IconAtlas.DimensionBits) * outputImageSize;
            var height = requiredHeight * outputImageSize;

            Console.WriteLine($"Creating atlas with dimensions {width}x{height}...");

            using var atlas = new Image<Rgba32>(width, height);
            
            // Draw all images onto the atlas
            for (var i = 0; i < iconsPaths.Count; i++)
            {
                var path = iconsPaths[i];
                if (path == null) continue;
                
                if (i % 1000 == 0)
                {
                    Console.WriteLine($"Processing icon {i + 1} of {iconsPaths.Count}...");
                }
                
                var image = LoadImageFromArchive(path);
                if (image == null) continue;
                
                using (image)
                {
                    if (image.Width != outputImageSize || image.Height != outputImageSize)
                        image.Mutate(x => x.Resize(outputImageSize, outputImageSize, KnownResamplers.Box));

                    var positionX = (i & IconAtlas.XMask) * outputImageSize;
                    var positionY = ((i & IconAtlas.YMask) >> IconAtlas.DimensionBits) * outputImageSize;
                    
                    atlas.Mutate(x => x.DrawImage(image, new Point(positionX, positionY), 1f));
                }
            }

            Console.WriteLine("Saving as WEBP (This might take a while)...");
            var encoder = new WebpEncoder
            {
                FileFormat = WebpFileFormatType.Lossless,
                NearLossless = true,
                NearLosslessQuality = 60,
                SkipMetadata = true,
            };
            
            using var fileStream = File.Create(savePath);
            atlas.Save(fileStream, encoder);

            Console.WriteLine($"Atlas creation complete. Saved to: {savePath}");
            return savePath;
        }

        public void Dispose()
        {
            archive.Dispose();
        }
    }
}
