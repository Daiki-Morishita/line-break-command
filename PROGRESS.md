# PROGRESS

## 2026-05-08
- 139_before/after.rtf を分析。改行ルールを学習。
- line_break.py 実装完了（ステージ1: 改行、ステージ2: 句読点削除）
- アルゴリズム: 読点優先分割 → DP最適化（最小行数→最大行長最小化）+ 行頭助詞ペナルティ + 鉤括弧内不改行 + 「ていない」途中不改行
- 使い方: `python3 line_break.py input.txt` で確認、`--finalize` で句読点削除
