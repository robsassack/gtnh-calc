import { PageModel, RecipeGroupModel, RecipeModel } from '../page';
import { SolvePage } from '../solver';
import * as fs from 'fs';
import * as path from 'path';
import { setupRepository } from './setup';

function loadTestFiles(): string[] {
    const testDir = path.join(__dirname, '..', '..', 'tests');
    const files = fs.readdirSync(testDir);
    return files.filter(file => file.endsWith('.gtnh'));
}

const testFiles = loadTestFiles();

function getRecipeExpectations(recipe: RecipeModel) {
    return {
        recipesPerMinute: recipe.recipesPerMinute,
        crafterCount: recipe.crafterCount,
        powerFactor: recipe.powerFactor,
        overclockFactor: recipe.overclockFactor,
        overclockName: recipe.overclockName,
        id: recipe.recipeId
    };
}

function processRecipeGroup(group: RecipeGroupModel): any[] {
    const expectations: any[] = [];
    for (const element of group.elements) {
        if (element instanceof RecipeModel) {
            expectations.push(getRecipeExpectations(element));
        } else if (element instanceof RecipeGroupModel) {
            expectations.push(...processRecipeGroup(element));
        }
    }
    return expectations;
}

describe('Solver', () => {
    beforeAll(async () => {
        await setupRepository();
    });

    describe('Test Files', () => {
        it('should have test files', () => {
            expect(testFiles.length).toBeGreaterThan(0);
        });
    });

    testFiles.forEach((testFile: string) => {
        describe(`Processing ${testFile}`, () => {
            it('should process without errors', async () => {
                const filePath = path.join(__dirname, '..', '..', 'tests', testFile);
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const pageData = JSON.parse(fileContent);
                
                const page = new PageModel(pageData);
                SolvePage(page);

                // Get expectations for all recipes and create a snapshot
                const expectations = processRecipeGroup(page.rootGroup);
                expect(expectations).toMatchSnapshot();
            });
        });
    });

    describe('Whole recipe batches', () => {
        it('constrains recipes to whole runs per selected time unit', () => {
            const filePath = path.join(__dirname, '..', '..', 'tests', 'Vinyl chloride.gtnh');
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const pageData = JSON.parse(fileContent);
            pageData.settings.wholeRecipeBatches = true;

            const page = new PageModel(pageData);
            SolvePage(page);

            expect(page.status).toBe("solved");
            const recipes = processRecipeGroup(page.rootGroup);
            for (const recipe of recipes) {
                const recipesPerUnit = recipe.recipesPerMinute / page.timeScale;
                expect(recipesPerUnit).toBeCloseTo(Math.round(recipesPerUnit), 6);
            }
        });

        it('does not satisfy ore dictionary inputs with self-referential placeholder recipes', () => {
            const page = new PageModel({
                products: [
                    {goodsId: 'i:gregtech:gt.blockmachines:1000', amount: 1}
                ],
                rootGroup: {
                    type: 'recipe_group',
                    links: {},
                    elements: [
                        {
                            type: 'recipe',
                            recipeId: 'r~BtvxNH_GNdaXnRhWNl0fJw==',
                            voltageTier: 1,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~Llz_qCCgMvycgqzMB6rxJQ==',
                            voltageTier: 1,
                            choices: {}
                        }
                    ],
                    collapsed: false,
                    name: 'Group'
                },
                settings: {minVoltage: 0, timeUnit: 'min', wholeRecipeBatches: true}
            });

            SolvePage(page);

            expect(page.status).toBe("solved");
            expect(page.rootGroup.flow.input['o:circuitBasic']).toBe(3);
            expect(page.rootGroup.flow.input['i:dreamcraft:item.CircuitLV:0']).toBeUndefined();
        });

        it('allows reverse byproduct links to become net external inputs', () => {
            const page = new PageModel({
                products: [
                    {goodsId: 'i:gregtech:gt.metaitem.03:32063', amount: 2}
                ],
                rootGroup: {
                    type: 'recipe_group',
                    links: {},
                    elements: [
                        {
                            type: 'recipe',
                            recipeId: 'r~7wNUkzkjNrOgdOumSB3ZGQ==',
                            voltageTier: 1,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~p3w7fqsnPg64KfrSVH5l0A==',
                            voltageTier: 0,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~ftl41CvsMJCUKYFMd1q1wg==',
                            voltageTier: 0,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~tSZHgWJgOXirOcI_RRq4YQ==',
                            voltageTier: 1,
                            choices: {coilTier: 0, muffler: 0}
                        }
                    ],
                    collapsed: false,
                    name: 'Group'
                },
                settings: {minVoltage: 0, timeUnit: 'min', wholeRecipeBatches: true}
            });

            SolvePage(page);

            expect(page.status).toBe("solved");
            const recipes = processRecipeGroup(page.rootGroup);
            expect(recipes.map(recipe => recipe.recipesPerMinute)).toEqual([1, 1, 1, 1]);
            expect(page.rootGroup.flow.input['i:gregtech:gt.metaitem.01:2856']).toBe(28);
        });

        it('does not let earlier byproducts reduce a later whole-batch producer requirement', () => {
            const page = new PageModel({
                products: [
                    {goodsId: 'i:gregtech:gt.metaitem.03:32063', amount: 8}
                ],
                rootGroup: {
                    type: 'recipe_group',
                    links: {},
                    elements: [
                        {
                            type: 'recipe',
                            recipeId: 'r~7wNUkzkjNrOgdOumSB3ZGQ==',
                            voltageTier: 1,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~p3w7fqsnPg64KfrSVH5l0A==',
                            voltageTier: 0,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~ftl41CvsMJCUKYFMd1q1wg==',
                            voltageTier: 0,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~tSZHgWJgOXirOcI_RRq4YQ==',
                            voltageTier: 1,
                            choices: {coilTier: 0, muffler: 0}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~mmtGaLCGPZWPs1CC0a0kvw==',
                            voltageTier: 0,
                            choices: {}
                        }
                    ],
                    collapsed: false,
                    name: 'Group'
                },
                settings: {minVoltage: 0, timeUnit: 'min', wholeRecipeBatches: true}
            });

            SolvePage(page);

            expect(page.status).toBe("solved");
            const recipes = processRecipeGroup(page.rootGroup);
            expect(recipes.map(recipe => recipe.recipesPerMinute)).toEqual([2, 1, 1, 1, 32]);
            expect(page.rootGroup.flow.output['i:gregtech:gt.metaitem.01:2856']).toBe(4);
        });

        it('supports whole-batch producer cycles that exchange fluids', () => {
            const page = new PageModel({
                products: [
                    {goodsId: 'i:gregtech:gt.metaitem.03:32063', amount: 8}
                ],
                rootGroup: {
                    type: 'recipe_group',
                    links: {},
                    elements: [
                        {
                            type: 'recipe',
                            recipeId: 'r~7wNUkzkjNrOgdOumSB3ZGQ==',
                            voltageTier: 1,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~p3w7fqsnPg64KfrSVH5l0A==',
                            voltageTier: 0,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~ftl41CvsMJCUKYFMd1q1wg==',
                            voltageTier: 0,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~tSZHgWJgOXirOcI_RRq4YQ==',
                            voltageTier: 1,
                            choices: {coilTier: 0, muffler: 0}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~mmtGaLCGPZWPs1CC0a0kvw==',
                            voltageTier: 0,
                            choices: {}
                        },
                        {
                            type: 'recipe',
                            recipeId: 'r~nM6t3Gb7PlOLFCbmzmPEUw==',
                            voltageTier: 0,
                            choices: {}
                        }
                    ],
                    collapsed: false,
                    name: 'Group'
                },
                settings: {minVoltage: 0, timeUnit: 'min', wholeRecipeBatches: true}
            });

            SolvePage(page);

            expect(page.status).toBe("solved");
            const recipes = processRecipeGroup(page.rootGroup);
            expect(recipes.map(recipe => recipe.recipesPerMinute)).toEqual([2, 1, 1, 1, 32, 32]);
            expect(page.rootGroup.flow.output['i:gregtech:gt.metaitem.01:2856']).toBe(4);
        });
    });
}); 
