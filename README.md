# Dinner Dash

Prompt

Build a mobile-first Progressive Web App (PWA) called Bachelor Dinner Planner.

The goal is to help a group of 10 Gujarati Indian bachelor roommates plan dinner every day while automatically planning groceries, preparation tasks, cooking instructions, and next day's lunch.

User Profile

 Pure vegetarian.

 No eggs.

 No chicken.

 No fish.

 No meat.

 No pork.

 No onion.

 No garlic.

 Recipes may be customized to remove onion and garlic.

 Dinner serves 20 plates because dinner is also packed for the next day's lunch for all 10 people.

 The app should scale ingredient quantities automatically if the serving size changes.

Core Problem

Every day we struggle with:

 What should we cook tonight?

 What groceries do we need?

 What can be prepared before cooking?

 Who should do each task?

 What is the cooking order?

 What ingredients are already available?

The app should make dinner planning almost effortless.

Weekly Menu Planner

This is only a suggested rotation, not a strict rule.

Examples:

Monday

 Traditional Gujarati meal

 Roti

 Rice

 Dal or Kadhi

 Shaak

 Occasionally Shrikhand or Aamras

Tuesday

 Punjabi

 Indian Chinese

 Chaat

 Dosa

 Mexican

 Pizza

 Pasta

Wednesday

 Light meal

 Dal Fry

 Jeera Rice

 Khichdi

 Kadhi

Thursday

 Roti

 Green vegetable dishes

 Bhindi Bateta

 Ringan Bateta

 Dudhi Chana

 Kobi Bateta

Friday

 Usually simple because we rarely cook elaborate meals.

Saturday

 Special meal

 Restaurant-style dishes

 Chaat

 Paneer

 Dosa

 Mexican

 Pizza

 Pasta

Sunday

 Flexible

 Can repeat favorites

 Try new recipes

The planner should recommend meals while allowing complete manual changes.

Main Features

Dashboard

Today's dinner

Today's grocery list

Preparation tasks

Cooking status

Assigned people

Time remaining

Weekly Planner

Calendar view

Drag-and-drop meals

Swap meals

Save favorite weekly plans

Generate next week's menu automatically

Grocery Planner

Automatically generate grocery list.

Separate into

 Vegetables

 Dairy

 Grains

 Spices

 Pantry

Allow checking off purchased items.

Support recurring pantry items.

Merge duplicate ingredients.

Recipe Screen

Each recipe should contain:

 Ingredients

 Quantity for 20 servings

 Preparation time

 Cooking time

 Step-by-step instructions

Split into three sections:

1. Shopping

Exactly what needs to be purchased.

2. Preparation

Everything that can be completed before cooking.

Examples:

 Wash vegetables

 Peel potatoes

 Chop vegetables

 Prepare dough

 Soak beans

 Make chutney

3. Cooking

Step-by-step cooking instructions.

Task Assignment

Since there are 10 roommates:

Allow assigning tasks.

Example:

Person A

 Chop vegetables

Person B

 Make dough

Person C

 Cook dal

Person D

 Wash dishes

Show task progress.

Grocery Inventory

Track pantry inventory.

Examples

Rice

Oil

Flour

Turmeric

Salt

Cumin

Automatically remove items from grocery list if already available.

Favorites

Save favorite recipes.

Rate recipes.

Search recipes.

Filter by

Gujarati

Punjabi

South Indian

Mexican

Italian

Indian Chinese

Chaat

Dessert

Meal Statistics

Show

Most cooked dishes

Least cooked dishes

Average grocery cost

Favorite cuisines

Cooking frequency

Recipe Sources

Do not use any paid AI APIs.

Do not require OpenAI, Anthropic, Gemini, or any paid model.

Use only publicly available recipe links.

Examples include:

 Tarla Dalal

 Food Lab

 Hebbars Kitchen

 Dassana's Veg Recipes

 Swasthi's Recipes

Store only:

Recipe title

Recipe URL

Short description

The user can open the original recipe when needed.

Design

Modern

Clean

Material Design 3

Warm colors

Simple for tired users after work

Large buttons

Bottom navigation

Dark mode

Light mode

Mobile-first

Technical Requirements

 Progressive Web App (PWA)

 Offline support

 Local storage

 No paid APIs

 Responsive

 Fast loading

 Easy to export data

 Easy to add new recipes manually

 Import recipes later from Apple Notes

Future Features

Design the architecture so these can be added later:

 Import recipes from Apple Notes

 OCR from recipe photos

 Barcode grocery scanning

 Expense splitting

 Grocery budget

 Notifications

 Shared household accounts

 Voice cooking mode

 AI meal recommendations (optional in the future)

 Nutrition tracking

Build this as a real production-quality application, not just a demo. Use clean architecture, reusable components, and make it easy to scale. Focus on solving the real workflow of planning, shopping, preparing, cooking, and coordinating meals for a shared household of 10 people.  

highest priority meal plaanning and setting what to eat for whole week 
what to bring and how much to bring

## Stack

- **Frontend** — React + TanStack Start (SSR), Tailwind, deployed on Vercel
- **Backend** — Supabase (Postgres, Auth, Realtime) with row level security
- **Icons** — regenerate with `python3 scripts/generate-icons.py`

## Development

```sh
bun install
bun run dev      # local dev server
bun run build    # production build
```

Copy `.env.example` to `.env` and fill in your Supabase project values.
