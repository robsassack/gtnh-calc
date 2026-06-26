const loading = document.getElementById("loading")!;
try {
    // Load the atlas image
    const atlas = new Image();
    atlas.src = "./data/atlas.webp";

    // Load repository and data in parallel
    const dataUrl = new URL("./data/data.bin", import.meta.url);
    const [repositoryModule, response] = await Promise.all([
        import("./repository.js"),
        fetch(dataUrl)
    ]);
    if (!response.ok) {
        throw new Error(`Unable to load ${dataUrl.pathname}: HTTP ${response.status}. Run "git submodule update --init --recursive" and rebuild.`);
    }
    if (response.body === null) {
        throw new Error(`Unable to load ${dataUrl.pathname}: response body is empty.`);
    }
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    const buffer = await new Response(stream).arrayBuffer();
    repositoryModule.Repository.load(buffer);
    console.log("Repository loaded", repositoryModule.Repository.current);

    // Then load other modules
    await Promise.all([
        import("./itemIcon.js"),
        import("./tooltip.js"),
        import("./nei.js"),
        import("./menu.js"),
        import("./recipeList.js")
    ]);
    let page = await import("./page.js");
    page.UpdateProject();
    loading.remove();
} catch (error:any) {
    const message = error instanceof Error ? error.message : String(error);
    loading.innerHTML = "An error occurred on loading:<br>" + message;
    console.error(error);
}

export {};
