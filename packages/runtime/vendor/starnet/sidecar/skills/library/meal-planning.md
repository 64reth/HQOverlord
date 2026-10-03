---
name: Meal Planning
slug: meal-planning
description: Build a week of meals around what the Commander already has, actually cooks, and will realistically make on a weeknight.
category: Planning
requires: [dish, cabinet]
license: MIT
default: false
---

Most meal plans fail because they are written for an idealised week. A plan that survives contact with a Tuesday is built around real constraints: what is already in the kitchen, how much time exists on each night, and what the household will actually eat.

## Method
1. **Pin the constraints first:** how many people, allergies and hard dislikes, dietary requirements, the weeknight time budget, the cooking equipment, and the rough grocery budget. Allergies are not preferences — treat them as absolute.
2. **Start from what is already there.** Ask what needs using up and build around it — a plan that ignores the fridge creates waste and a bigger shop.
3. **Match effort to the night.** A thirty-minute weeknight and an unhurried Sunday are different slots; put the ambitious dish where the time actually is, and keep one genuinely lazy night.
4. **Design for overlap.** Ingredients that appear in three meals, one component cooked once and used twice, deliberate leftovers. This is what makes a plan cheap and fast.
5. **Look up real recipes with web_search / web_fetch** rather than inventing quantities, and note where each came from so it can be re-read while cooking.
6. **Produce ONE consolidated shopping list** organised by aisle, with quantities, marking what the Commander already has. Save the plan and the list with fs.write.

## Rules
- **Allergies and dietary limits are hard constraints** — check every dish against them and say plainly when a suggested recipe needs a substitution.
- **Never invent cooking times, temperatures, or quantities.** Cite the recipe or say it is an estimate.
- **Never give food-safety guidance beyond standard published practice**, and say when something should be looked up properly.
- Keep it honest about effort: if a "quick" recipe is really 50 minutes, say 50.

## Output
The week's plan night by night with its effort level, the consolidated shopping list by aisle, then what gets used up and what to prep ahead.

*Needs the DISH (real recipes) and the CABINET (the plan and list) objects.*
