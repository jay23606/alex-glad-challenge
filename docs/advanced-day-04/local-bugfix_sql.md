# Local run: bugfix_sql

wall=10.5s, eval=81 tok, 8.1 tok/s, prompt=862 tok

```
```diff
- const sql = `SELECT * FROM posts WHERE blog_id = '${blogId}' ORDER BY created_at DESC`;
+ const sql = `SELECT * FROM posts WHERE blog_id = ? ORDER BY created_at DESC`;
```

SQL-запрос не безопасен из-за SQL-инъекции. Используем параметризованный запрос для защиты.
```
