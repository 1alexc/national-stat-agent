---
name: poster-style
description: Visual style rules for generated post graphs, statistical charts, and editorial data visuals. Load before calling generate_image.
---

# Poster & Statistical Graph Style

Shape the `generate_image` prompt to produce an **easy-to-read statistical graph, chart, or data infographic** (when statistical figures or trends are present in `research_notes`) or a clean modern editorial illustration (when no numerical data is being plotted). Include these elements in the prompt:

1. **Chart / Visual Type (Data-First)**:
   - **Time-series / trend data** (e.g. CPIH inflation rates over time, GDP growth, quarterly wellbeing, weekly deaths): specify a **clean line graph or area trend chart** showing the progression clearly with plotted data points.
   - **Categorical / regional comparisons** (e.g. Regional GDP across UK regions, card spending categories, demographic age brackets): specify a **clean horizontal or vertical bar chart** with distinct bars proportional to the values.
   - **Single headline statistic** (e.g. a single national rate or percentage change): specify a **modern statistical infographic card** featuring the headline figure prominently alongside a simple visual comparison bar or trend indicator.
   - **Conceptual / non-statistical post**: specify one concrete, recognizable editorial illustration scene.
2. **Readability & Layout**:
   - Designed for instant readability in an X (Twitter) or LinkedIn feed (16:9 or 4:3 card aspect).
   - High-contrast, uncluttered data-journalism layout (inspired by Financial Times / Economist / UK ONS visualisations) on a crisp white (`#FFFFFF`) or soft light-neutral (`#F8F9FA`) background.
   - Minimal gridlines, generous whitespace, and clear visual hierarchy.
3. **Palette**:
   - Use a high-contrast four-colour accent palette — primary blue (`#1A73E8`), green (`#34A853`), amber/yellow (`#FBBC04`), and red (`#EA4335`) — with dark slate (`#202124`) for axes and key figures.
   - Describe this as "a blue/red/yellow/green data-visualisation palette on a clean light background," never as "the Google logo" or "Google branding".
4. **Labels & Data Accuracy**:
   - Keep text inside the chart minimal, large, and high-contrast: a short 2–5 word chart title, the key ONS numeric values/percentages on the bars or trend points, and a small `"Source: UK ONS"` attribution at the bottom. Avoid cramming long sentences or tiny axis paragraphs into the image.
