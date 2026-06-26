using System.IO.Compression;
using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using System.Security.Cryptography;
using System.Text;
using Source.Data;

namespace export;

public class OldRecipesGenerator
{
    private sealed class OldDataReader : IDisposable
    {
        private readonly string tempPath;
        private readonly MemoryMappedFile memoryMappedFile;
        private readonly MemoryMappedViewAccessor accessor;
        private readonly long length;

        public OldDataReader(string dataBinPath)
        {
            var tempDir = Path.GetDirectoryName(Path.GetFullPath(dataBinPath)) ?? Directory.GetCurrentDirectory();
            tempPath = Path.Combine(tempDir, Path.GetRandomFileName() + ".unpacked");
            using (var source = File.OpenRead(dataBinPath))
            using (var zip = new GZipStream(source, CompressionMode.Decompress))
            using (var temp = File.Create(tempPath))
            {
                zip.CopyTo(temp);
            }

            memoryMappedFile = MemoryMappedFile.CreateFromFile(tempPath, FileMode.Open, null, 0, MemoryMappedFileAccess.Read);
            accessor = memoryMappedFile.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
            length = accessor.Capacity;
        }

        public int ReadInt(int index)
        {
            var offset = (long)index * sizeof(int);
            if (offset < 0 || offset > length - sizeof(int))
                throw new InvalidDataException("Invalid int pointer " + index);
            return accessor.ReadInt32(index * sizeof(int));
        }

        public (int Start, int Length) ReadSlice(int pointer)
        {
            var target = ReadInt(pointer);
            return (target + 1, ReadInt(target));
        }

        public string ReadString(int pointer)
        {
            var target = ReadInt(pointer);
            var length = ReadInt(target);
            if (length < 0 || length > 1024 * 1024)
                throw new InvalidDataException("Invalid string length " + length + " at pointer " + pointer);
            var offset = (long)(target + 1) * sizeof(int);
            if (offset < 0 || offset + length > this.length)
                throw new InvalidDataException("Invalid string range at pointer " + pointer);
            var bytes = new byte[length];
            accessor.ReadArray(offset, bytes, 0, length);
            return Encoding.UTF8.GetString(bytes);
        }

        public void Dispose()
        {
            accessor.Dispose();
            memoryMappedFile.Dispose();
            File.Delete(tempPath);
        }
    }

    private static bool ShouldReportProgress(int processed, int total, Stopwatch timer, ref int lastPercent, ref long lastMilliseconds)
    {
        if (total <= 0)
            return false;
        var percent = processed * 100 / total;
        if (percent == lastPercent || timer.ElapsedMilliseconds - lastMilliseconds < 1000)
            return false;
        lastPercent = percent;
        lastMilliseconds = timer.ElapsedMilliseconds;
        return true;
    }

    private static void AppendHash<T>(IncrementalHash hash1, IncrementalHash hash2, RecipeInput<T>[] inputs) where T:GoodsOrDict
    {
        foreach (var input in inputs)
        {
            if (input.amount > 0)
            {
                var encodedId = Encoding.UTF8.GetBytes(input.goods.id);
                hash1.AppendData(encodedId);
                hash2.AppendData(encodedId);
                hash1.AppendData(BitConverter.GetBytes(input.amount));
            }
        }
    }
    
    private static void AppendHash<T>(IncrementalHash hash1, IncrementalHash hash2, RecipeProduct<T>[] inputs) where T:Goods
    {
        foreach (var input in inputs)
        {
            var encodedId = Encoding.UTF8.GetBytes(input.goods.id);
            hash1.AppendData(encodedId);
            hash2.AppendData(encodedId);
            hash1.AppendData(BitConverter.GetBytes(input.amount));
        }
    }
    
    public static void PopulateOldRecipes(Repository repository, string oldDataBin)
    {
        Console.WriteLine("Calculating recipe remaps...");
        using var oldData = new OldDataReader(oldDataBin);
        var allRecipes = oldData.ReadSlice(5);
        var dataVersion = oldData.ReadInt(0);

        var recipesById = new Dictionary<string, Recipe>();
        var recipesByHash = new Dictionary<string, Recipe>();
        foreach (var recipe in repository.recipes)
        {
            // Calculate hash of the recipe two ways: The first by recipe inputs, outputs and amounts, and the second only by recipe inputs and outputs.
            // Match old recipes to new ones by the first one or by the second one as a fallback
            recipesById[recipe.id] = recipe;
            using var hash1 = IncrementalHash.CreateHash(HashAlgorithmName.MD5);
            using var hash2 = IncrementalHash.CreateHash(HashAlgorithmName.MD5);
            var recipeTypeName = Encoding.UTF8.GetBytes(recipe.recipeType.name);
            hash1.AppendData(recipeTypeName);
            hash2.AppendData(recipeTypeName);
            AppendHash(hash1, hash2, recipe.itemInputs);
            AppendHash(hash1, hash2, recipe.oreDictInputs);
            AppendHash(hash1, hash2, recipe.fluidInputs);
            AppendHash(hash1, hash2, recipe.itemOutputs);
            AppendHash(hash1, hash2, recipe.fluidOutputs);
            recipesByHash[Convert.ToBase64String(hash1.GetCurrentHash())] = recipe;
            recipesByHash[Convert.ToBase64String(hash2.GetCurrentHash())] = recipe;
        }

        var missingRecipes = 0;
        var newRemaps = 0;
        var remappedRecipes = new Dictionary<string, Recipe>();
        var timer = Stopwatch.StartNew();
        var lastPercent = -1;
        var lastMilliseconds = -1000L;
        for (var recipeIndex = 0; recipeIndex < allRecipes.Length; recipeIndex++)
        {
            var recipe = oldData.ReadInt(allRecipes.Start + recipeIndex);
            if (ShouldReportProgress(recipeIndex + 1, allRecipes.Length, timer, ref lastPercent, ref lastMilliseconds))
                Console.WriteLine("Calculating recipe remaps: " + lastPercent + "% (" + (recipeIndex + 1) + "/" + allRecipes.Length + " old recipes checked)");

            var id = oldData.ReadString(recipe + 4);
            if (recipesById.ContainsKey(id))
                continue;

            var recipeTypePtr = oldData.ReadInt(recipe + 6);
            var recipeIoList = oldData.ReadSlice(recipe + 5);

            using var hash1 = IncrementalHash.CreateHash(HashAlgorithmName.MD5);
            using var hash2 = IncrementalHash.CreateHash(HashAlgorithmName.MD5);
            var recipeTypeName = Encoding.UTF8.GetBytes(oldData.ReadString(recipeTypePtr));
            hash1.AppendData(recipeTypeName);
            hash2.AppendData(recipeTypeName);
            for (var i = 0; i < recipeIoList.Length; i+=5)
            {
                var type = oldData.ReadInt(recipeIoList.Start + i);
                var goods = oldData.ReadInt(recipeIoList.Start + i + 1);
                var amount = oldData.ReadInt(recipeIoList.Start + i + 3);

                var goodsId = Encoding.UTF8.GetBytes(oldData.ReadString(goods + 4));
                if (amount > 0 || type >= 3)
                {
                    hash1.AppendData(goodsId);
                    hash2.AppendData(goodsId);
                    hash1.AppendData(BitConverter.GetBytes(amount));
                }
            }
            
            if (recipesByHash.TryGetValue(Convert.ToBase64String(hash1.GetCurrentHash()), out var existingRecipe) 
                || recipesByHash.TryGetValue(Convert.ToBase64String(hash2.GetCurrentHash()), out existingRecipe))
            {
                remappedRecipes[id] = existingRecipe;
                repository.remaps.Add(new RecipeRemap {from = id, to = existingRecipe});
                newRemaps++;
            } 
            else
            {
                missingRecipes++;
            }
        }

        var oldRemaps = 0;
        var skippedOldRemaps = 0;
        if (dataVersion >= 4)
        {
            var oldRemap = oldData.ReadSlice(7);
            lastPercent = -1;
            lastMilliseconds = -1000L;
            for (var remapIndex = 0; remapIndex < oldRemap.Length; remapIndex++)
            {
                var remap = oldData.ReadInt(oldRemap.Start + remapIndex);
                if (ShouldReportProgress(remapIndex + 1, oldRemap.Length, timer, ref lastPercent, ref lastMilliseconds))
                    Console.WriteLine("Applying old recipe remaps: " + lastPercent + "% (" + (remapIndex + 1) + "/" + oldRemap.Length + " old remaps checked)");

                string idFrom;
                string idTo;
                try
                {
                    idFrom = oldData.ReadString(oldData.ReadInt(remap));
                    idTo = oldData.ReadString(oldData.ReadInt(remap+1) + 4);
                }
                catch (InvalidDataException ex)
                {
                    skippedOldRemaps++;
                    Console.WriteLine("Skipping invalid old remap " + remapIndex + ": " + ex.Message);
                    continue;
                }

                var recipeTo = recipesById.GetValueOrDefault(idTo) ?? remappedRecipes.GetValueOrDefault(idTo);
                if (recipeTo == null)
                    continue;
                remappedRecipes[idFrom] = recipeTo;
                repository.remaps.Add(new RecipeRemap {from = idFrom, to = recipeTo});
                oldRemaps++;
            }
        }
        
        Console.WriteLine("Missing recipes: "+missingRecipes+", Remapped recipes: "+newRemaps+", Old remaps: "+oldRemaps+", Skipped old remaps: "+skippedOldRemaps);
    }
}
