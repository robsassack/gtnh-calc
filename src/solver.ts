import { Model, Solution } from "./types/javascript-lp-solver.js";
import { PageModel, RecipeGroupModel, RecipeModel, ProductModel, FlowInformation, LinkAlgorithm, OverclockResult } from './page.js';
import { Goods, Item, OreDict, Recipe, RecipeIoType, RecipeObject, Repository } from "./repository.js";
import { singleBlockMachine, machines, notImplementedMachine, GetSingleBlockMachine, GetParameter } from "./machines.js";
import { voltageTier } from "./utils.js";

class LinkCollection {
    output: {[key:string]:{[key:string]:number}} = {};
    input: {[key:string]:{[key:string]:number}} = {};
    inputOreDict: {[key:string]:{[key:string]:number}} = {};
    inputOreDictRecipe: {[key:string]:RecipeModel[]} = {};
    recipeOrder: {[key:string]:number} = {};

    SetRecipeOrder(linkVar:string, order:number):void {
        this.recipeOrder[linkVar] = order;
    }

    AddInput(goods:RecipeObject, amount:number, linkVar:string):void {
        if (amount === 0) return;
        let input = this.input[goods.id] ||= {};
        input[linkVar] = (input[linkVar] || 0) + amount;
    }

    AddOutput(goods:RecipeObject, amount:number, linkVar:string):void {
        let output = this.output[goods.id] ||= {};
        output[linkVar] = (output[linkVar] || 0) - amount;
    }

    AddInputOreDict(oreDict:RecipeObject, amount:number, linkVar:string, recipe:RecipeModel):void {
        if (amount === 0) return;
        let inputOreDict = this.inputOreDict[oreDict.id] ||= {};
        inputOreDict[linkVar] = (inputOreDict[linkVar] || 0) + amount;
        let inputOreDictRecipe = this.inputOreDictRecipe[oreDict.id] ||= [];
        inputOreDictRecipe.push(recipe);
    }
    
    Merge(other:LinkCollection):void {
        for (const key in other.output) {
            this.output[key] = {...this.output[key], ...other.output[key]};
        }
        for (const key in other.input) {
            this.input[key] = {...this.input[key], ...other.input[key]};
        }
        for (const key in other.inputOreDict) {
            this.inputOreDict[key] = {...this.inputOreDict[key], ...other.inputOreDict[key]};
        }
        for (const key in other.inputOreDictRecipe) {
            this.inputOreDictRecipe[key] = [...this.inputOreDictRecipe[key] || [], ...other.inputOreDictRecipe[key]];
        }
        this.recipeOrder = {...this.recipeOrder, ...other.recipeOrder};
    }
}

function MatchVariablesToConstraints(model:Model, name:string, variableList: {[key:string]:number}):void
{
    for (const key in variableList) {
        if (key === "_amount") continue;
        model.variables[key][name] = (model.variables[key][name] || 0) + variableList[key];
    }
}

function HasForwardOutput(input:{[key:string]:number}, output:{[key:string]:number}, recipeOrder:{[key:string]:number}):boolean
{
    return Object.keys(GetForwardOutput(input, output, recipeOrder)).length > 0;
}

function GetEarliestInputOrder(input:{[key:string]:number}, recipeOrder:{[key:string]:number}):number
{
    let earliestInput = Number.POSITIVE_INFINITY;
    for (const key in input) {
        if (key === "_amount")
            continue;
        earliestInput = Math.min(earliestInput, recipeOrder[key] ?? Number.POSITIVE_INFINITY);
    }
    return earliestInput;
}

function GetForwardOutput(input:{[key:string]:number}, output:{[key:string]:number}, recipeOrder:{[key:string]:number}):{[key:string]:number}
{
    let result:{[key:string]:number} = {};
    const earliestInput = GetEarliestInputOrder(input, recipeOrder);
    for (const key in output) {
        if (key === "_amount")
            continue;
        if ((recipeOrder[key] ?? Number.NEGATIVE_INFINITY) >= earliestInput)
            result[key] = output[key];
    }
    return result;
}

function CreateLinkByAlgorithm(model:Model, algorithm:LinkAlgorithm, group:RecipeGroupModel, goodsId:string, collectionKey:string,
    collection:{[key:string]:{[key:string]:number}}, matchedOutputs:{[key:string]:{[key:string]:number}|null}, outputAmount:{[key:string]:number}, useMinimumLinks:boolean,
    recipeOrder:{[key:string]:number})
{
    var linkName = `link_${group.iid}_${goodsId}`;
    const inputAmount = collection[collectionKey];
    let amount = inputAmount["_amount"] || -outputAmount["_amount"] || 0;
    let outputForConstraint = outputAmount;
    let shouldConstrainLink = false;
    delete collection[collectionKey];
    group.actualLinks[goodsId] = algorithm;
    if (!useMinimumLinks) {
        model.constraints[linkName] = {equal:amount};
        shouldConstrainLink = true;
    } else if (amount !== 0 || HasForwardOutput(inputAmount, outputAmount, recipeOrder)) {
        if (amount === 0)
            outputForConstraint = GetForwardOutput(inputAmount, outputAmount, recipeOrder);
        model.constraints[linkName] = {max: amount};
        shouldConstrainLink = true;
    }
    if (shouldConstrainLink) {
        MatchVariablesToConstraints(model, linkName, inputAmount);
        matchedOutputs[goodsId] = outputForConstraint;
    } else {
        matchedOutputs[goodsId] = null;
    }
}

function HasNetOutputForOreDictCandidate(input:{[key:string]:number}, output:{[key:string]:number}):boolean
{
    let netOutput = 0;
    for (const key in output) {
        if (key === "_amount")
            continue;
        netOutput += output[key] + (input[key] || 0);
    }
    return netOutput < -0.000001;
}

function PreProcessRecipe(recipeModel:RecipeModel, model:Model, collection:LinkCollection, wholeRecipeBatches:boolean, timeScale:number, order:number)
{
    let recipe = Repository.current.GetById<Recipe>(recipeModel.recipeId);
    if (!recipe)
        return;
    recipeModel.recipe = recipe;
    let varName = `recipe_${recipeModel.iid}`;
    model.variables[varName] = {"obj":1};
    collection.SetRecipeOrder(varName, order);

    if (wholeRecipeBatches) {
        const batchVarName = `recipe_batches_${recipeModel.iid}`;
        const batchConstraintName = `whole_recipe_batches_${recipeModel.iid}`;
        model.variables[batchVarName] = {
            "obj": 0,
            [batchConstraintName]: -timeScale,
        };
        model.variables[varName][batchConstraintName] = 1;
        model.constraints[batchConstraintName] = {equal: 0};
        model.ints ||= {};
        model.ints[batchVarName] = 1;
    }

    recipeModel.overclockFactor = 1;

    let gtRecipe = recipe.gtRecipe;
    let machineInfo = null;
    if (gtRecipe && gtRecipe.durationTicks > 0) {
        let crafter = recipeModel.crafter ? Repository.current.GetById<Item>(recipeModel.crafter) : null;
        if (crafter != null && !recipe.recipeType.multiblocks.includes(crafter))
            crafter = null;
        let canBeSingleblock = (() => {
            if (recipe.recipeType.singleblocks.length == 0)
                return false;
            const machine = GetSingleBlockMachine(recipe.recipeType);
            const excluded = machine?.excludesRecipe ? machine.excludesRecipe(recipe) : false;
            return !excluded;
        })();

        if (crafter === null && !canBeSingleblock) {
            for(let i = 0; i < recipe.recipeType.multiblocks.length; ++i) {
                const item = recipe.recipeType.multiblocks[i];
                const machine = machines[item.name];
                const excluded = machine?.excludesRecipe ? machine.excludesRecipe(recipe) : false;
                if (!excluded) {
                    crafter = item;
                    break;
                }
            }
            if (crafter === null)
                crafter = recipe.recipeType.defaultCrafter;
        }
        let isSingleblock = !crafter;
        machineInfo = crafter ? (machines[crafter.name] || notImplementedMachine) : GetSingleBlockMachine(recipe.recipeType);
        recipeModel.multiblockCrafter = crafter;
        recipeModel.machineInfo = machineInfo;
        if (machineInfo.fixedVoltageTier) {
            recipeModel.voltageTier = GetParameter(machineInfo.fixedVoltageTier, recipeModel)!;
        }
        recipeModel.ValidateChoices(machineInfo, recipeModel);
        let amperage = gtRecipe.amperage;
        let actualVoltage = voltageTier[recipeModel.voltageTier].voltage;
        let machineParallels = Math.max(1, GetParameter(machineInfo.parallels, recipeModel));
        let energyModifier = GetParameter(machineInfo.power, recipeModel);
        let maxParallels = machineInfo.ignoreParallelLimit ? machineParallels : Math.max(1, Math.floor(actualVoltage / (gtRecipe.voltage * energyModifier * amperage)));
        let parallels = Math.min(maxParallels, machineParallels);
        let tierDifference = recipeModel.voltageTier - gtRecipe.voltageTier;
        let overclockTiers = isSingleblock ? tierDifference : Math.min(tierDifference, Math.floor(Math.log2(maxParallels / parallels) / 2));
        let overclockResult = GetParameter(machineInfo.overclocker, recipeModel).calculate(recipeModel, overclockTiers);
        let speedModifier = GetParameter(machineInfo.speed, recipeModel);
        //console.log({machineParallels, maxParallels, parallels, overclockTiers, overclockSpeed, overclockPower, energyModifier, speedModifier});
        
        // Handle duration rounding. It always truncates decimals, i.e. favoring the player.
        // In case of subtick processing we assume no rounding is taking place, which is a good approximation for now.
        // Some machines round after parallels, for example Advanced Assembly Line
        const durationTicksForRounding = machineInfo.roundAfterParallels ? (gtRecipe.durationTicks / parallels) : gtRecipe.durationTicks;
        const estimatedDurationTicks = durationTicksForRounding / (overclockResult.overclockSpeed * speedModifier);
        let speedCorrectionFactor = 1.0;
        if (estimatedDurationTicks > 1) {
            const roundedEstimatedDurationTicks = Math.floor(estimatedDurationTicks);
            speedCorrectionFactor = estimatedDurationTicks / roundedEstimatedDurationTicks;
        }

        recipeModel.overclockFactor = overclockResult.overclockSpeed * speedModifier * speedCorrectionFactor * parallels;
        recipeModel.powerFactor = amperage * overclockResult.overclockPower * energyModifier / speedModifier / speedCorrectionFactor;
        recipeModel.parallels = parallels;
        recipeModel.overclockTiers = overclockTiers;
        recipeModel.overclockName = overclockResult.overclockName;

        if (recipeModel.fixedCrafterCount) {
            let crafterName = `fixed_${recipeModel.iid}`;
            let fixedRecipesPerMinute = recipeModel.fixedCrafterCount * recipeModel.overclockFactor / recipe.gtRecipe.durationMinutes;
            model.variables[varName][crafterName] = 1;
            model.constraints[crafterName] = {equal:fixedRecipesPerMinute};
        }
    }

    let recipeItems = machineInfo?.recipe ? machineInfo.recipe(recipeModel, recipeModel.choices, recipe.items) : recipe.items;
    recipeModel.recipeItems = recipeItems;

    for (const slot of recipeItems) {
        const goods = slot.goods;
        let amount = slot.amount * slot.probability;
        let container = goods instanceof Item && goods.container;

        if (slot.type == RecipeIoType.OreDictInput) {
            collection.AddInputOreDict(goods, amount, varName, recipeModel);
        } else if (container) {
            if (slot.type == RecipeIoType.ItemOutput) {
                collection.AddOutput(container.fluid, amount * container.amount, varName);
                collection.AddOutput(container.empty, amount, varName);
            } else if (slot.type == RecipeIoType.ItemInput) {
                collection.AddInput(container.fluid, amount * container.amount, varName);
                collection.AddInput(container.empty, amount, varName);
            }
        } else {
            if (slot.type == RecipeIoType.ItemOutput || slot.type == RecipeIoType.FluidOutput) {
                collection.AddOutput(goods, amount, varName);
            } else if (slot.type == RecipeIoType.ItemInput || slot.type == RecipeIoType.FluidInput) {
                collection.AddInput(goods, amount, varName);
            }
        }
    }
}

function CreateAndMatchLinks(group:RecipeGroupModel, model:Model, collection:LinkCollection, wholeRecipeBatches:boolean, timeScale:number, order:{value:number})
{
    for (const child of group.elements) {
        if (child instanceof RecipeModel) {
            PreProcessRecipe(child, model, collection, wholeRecipeBatches, timeScale, order.value++);
        } else if (child instanceof RecipeGroupModel) {
            let childCollection:LinkCollection = new LinkCollection();
            CreateAndMatchLinks(child, model, childCollection, wholeRecipeBatches, timeScale, order);
            collection.Merge(childCollection);
        }
    }

    console.log("Raw collection",collection);

    let matchedOutputs: {[key:string]:{[key:string]:number}|null} = {};
    group.actualLinks = {...group.links};

    for (const key of Object.keys(collection.inputOreDict)) {
        var oreDict = Repository.current.GetById<OreDict>(key)!;
        for (const item of oreDict.items) {
            let algorithm = group.links[item.id] || LinkAlgorithm.Match;
            if (collection.output[item.id] === undefined)
                continue;
            if (!HasNetOutputForOreDictCandidate(collection.inputOreDict[key], collection.output[item.id]))
                continue;
            // Despite the fact that we are ignoring the link, we still need to select the ore dict item to have the same item in production and consumption
            for (const recipe of collection.inputOreDictRecipe[key])
                recipe.selectedOreDicts[key] = item;
            if (algorithm === LinkAlgorithm.Ignore)
                continue;

            CreateLinkByAlgorithm(model, algorithm, group, item.id, key, collection.inputOreDict, matchedOutputs, collection.output[item.id], wholeRecipeBatches, collection.recipeOrder);
            break
        }
    }

    for (const key of Object.keys(collection.input)) {
        var algorithm = group.links[key] || LinkAlgorithm.Match;
        if (algorithm === LinkAlgorithm.Ignore || collection.output[key] === undefined)
            continue;

        CreateLinkByAlgorithm(model, algorithm, group, key, key, collection.input, matchedOutputs, collection.output[key], wholeRecipeBatches, collection.recipeOrder);
    }

    for (const key in matchedOutputs) {
        var linkName = `link_${group.iid}_${key}`;
        if (matchedOutputs[key] !== null)
            MatchVariablesToConstraints(model, linkName, matchedOutputs[key]);
        delete collection.output[key];
    }

    return collection;
}

function ApplySolutionRecipe(recipeModel:RecipeModel, solution:Solution):void
{
    let flow:FlowInformation = new FlowInformation();
    recipeModel.flow = flow;
    let name = `recipe_${recipeModel.iid}`;
    let recipe = recipeModel.recipe;
    let solutionValue = (solution[name] || 0) as number;
    recipeModel.recipesPerMinute = solutionValue;
    recipeModel.crafterCount = 0;
    for (const item of recipeModel.recipeItems) {
        var goods:RecipeObject = item.goods;
        if (item.type == RecipeIoType.OreDictInput && recipeModel.selectedOreDicts[item.goods.id])
            goods = recipeModel.selectedOreDicts[item.goods.id];

        var isProduction = item.type == RecipeIoType.FluidOutput || item.type == RecipeIoType.ItemOutput;
        let amount = item.amount * item.probability * solutionValue;
        let container = goods instanceof Item && goods.container;
        if (container) {
            flow.Add(container.fluid, amount * container.amount, isProduction);
            flow.Add(container.empty, amount, isProduction);
        } else flow.Add(goods, amount, isProduction);
    }

    let gtRecipe = recipe?.gtRecipe;
    if (gtRecipe && gtRecipe.durationTicks > 0) {
        flow.energy[recipeModel.voltageTier] = gtRecipe.durationMinutes * gtRecipe.voltage * solutionValue * recipeModel.powerFactor;
        recipeModel.crafterCount = solutionValue * gtRecipe.durationMinutes / recipeModel.overclockFactor;
    }
}

function ApplySolutionGroup(group:RecipeGroupModel, solution:Solution, model:Model, feasible:boolean):void
{
    for (const child of group.elements) {
        if (child instanceof RecipeModel)
            ApplySolutionRecipe(child, solution);
        else if (child instanceof RecipeGroupModel)
            ApplySolutionGroup(child, solution, model, feasible);
    }

    let flow:FlowInformation = new FlowInformation();
    group.flow = flow;
    for (const child of group.elements) {
        flow.Merge(child.flow);
    }
    for (const link in group.actualLinks) {
        let delta = (flow.input[link] || 0) - (flow.output[link] || 0);
        if (delta > 0.01) {
            flow.input[link] = delta;
            delete flow.output[link];
        } else if (delta < -0.01) {
            flow.output[link] = -delta;
            delete flow.input[link];
        } else {
            delete flow.input[link];
            delete flow.output[link];
        }
    }
}

export function SolvePage(page:PageModel):void
{
    try {
        let model:Model = {
            optimize: "obj",
            opType: "min",
            constraints: {},
            variables: {},
        }
        let timeUnit = page.settings.timeUnit;
        let timeScale = timeUnit === "hour" ? 1/60: timeUnit === "sec" ? 60 : timeUnit === "tick" ? 20 * 60: 1;
        page.timeScale = timeScale;
        let collection:LinkCollection = new LinkCollection();
        for (const product of page.products) {
            if (product.amount > 0) {
                collection.input[product.goodsId] = {"_amount": -product.amount};
            } else {
                collection.output[product.goodsId] = {"_amount": product.amount};
            }
        }
        CreateAndMatchLinks(page.rootGroup, model, collection, page.settings.wholeRecipeBatches, timeScale, {value: 0});
        console.log("Solve model",model);

        let solution = window.solver.Solve(model);
        console.log("Solve solution",solution);
        page.status = solution.feasible ? solution.bounded ? "solved" : "unbounded" : "infeasible";
        ApplySolutionGroup(page.rootGroup, solution, model, solution.feasible);
    } catch (error) {
        console.error("Error solving page",error);
    }
}
