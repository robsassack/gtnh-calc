using export;
using Source.Data;

namespace Source
{
    public static class PackGenerator
    {
        private static void LogMemory(string phase)
        {
            var managed = GC.GetTotalMemory(false) / 1024 / 1024;
            var process = Environment.WorkingSet / 1024 / 1024;
            Console.WriteLine($"Memory after {phase}: managed {managed} MiB, process {process} MiB");
        }

        public static void Generate(string sourcePath, string targetPath, bool skipIcons = false, string previousDataBin = null)
        {
            var dbParser = new DatabaseParser();
            dbParser.Parse(Path.Combine(sourcePath, "nesql-db.script"));
            LogMemory("parsing");

            var iconList = new List<string>();
            var repository = PackConverter.Convert(dbParser, iconList);
            dbParser = null;
            GC.Collect();
            LogMemory("conversion");
            
            PackPreProcessor.PreProcessPack(repository);
            LogMemory("preprocessing");
            HardcodeFixes.Fix(repository);
            FontCharactersFixer.FixFontCharacters(repository);
            RecipeConflictsCalculator.CalculateRecipeConflicts(repository);
            LogMemory("recipe conflict calculation");
            
            if (previousDataBin != null)
            {
                OldRecipesGenerator.PopulateOldRecipes(repository, previousDataBin);
                LogMemory("recipe remaps");
            }
            
            Console.WriteLine("Exporting data.bin...");
            var mmap = new MemoryMappedPackConverter(repository);
            Directory.CreateDirectory(targetPath);
            mmap.WriteTo(Path.Combine(targetPath, "data.bin"));
            LogMemory("data.bin export");
            mmap = null;
            repository = null;
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            LogMemory("data cleanup");
            
            if (!skipIcons)
            {
                using var builder = new AtlasBuilder(Path.Combine(sourcePath, "image.zip"), Path.Combine(targetPath, "atlas.webp"));
                builder.BuildAtlas(iconList);
                LogMemory("atlas export");
            }
        }
    }
}
