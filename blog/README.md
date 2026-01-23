# Blog Entries

## How to Add a New Blog Entry

Simply edit the `entries.json` file and add a new entry at the **top** of the array (so newest posts appear first):

```json
[
  {
    "date": "2025.12.20",
    "content": "Your new blog entry content here!"
  },
  {
    "date": "2025.12.18",
    "content": "gym was fucking great today. back + bi, abs, cardio. we back baby. gonna work on progsu and linear algebra td."
  },
  {
    "date": "2025.12.17",
    "content": "built another iron golem farm in my smp. now we printing iron ingots."
  }
]
```

## That's it!

Your new entry will automatically appear on your website. No need to touch the HTML file anymore!

## Tips

- Keep entries in **reverse chronological order** (newest first)
- Date format: `YYYY.MM.DD`
- You can use any text in the content field
- To delete an entry, just remove it from the JSON array

