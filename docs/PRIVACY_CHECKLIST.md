# Privacy Checklist / 发布前隐私清单

Check this before publishing your own fork or sending the repository to another person.

发布自己的分支或发给别人之前，建议先检查这一页。

## Do Not Commit / 不要提交

- API keys, tokens, passwords, or `.env` files
- Private persona core content
- Private memory databases
- Diaries, growth logs, or private notes
- Raw chat exports
- Private screenshots
- Real movie frames or copyrighted videos
- Downloaded subtitle files with unclear copyright status
- Local absolute paths such as `C:\`, `D:\`, or `G:\`
- Full backups of a private companion app

## Suggested Searches / 建议搜索

```bash
rg "sk-"
rg "Bearer "
rg "api key|apikey|api_key" -i
rg "C:\\\\|D:\\\\|G:\\\\"
rg "private|secret|token|password" -i
```

`Obsidian` is not private by itself, but a real vault path or private note content should not be published.

`Obsidian` 这个词本身不一定私密，但真实库路径或私人笔记内容不要发布。

## Safe To Include / 可以提交

- Generic UI components
- Generic demo persona text
- Generic demo memory notes
- Placeholder or synthetic assets
- Architecture docs
- Integration prompts
- LocalStorage watch-progress logic
- Adapter interfaces
