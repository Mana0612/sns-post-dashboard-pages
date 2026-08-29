# SNS投稿ダッシュボード（GitHub Pages公開用）

投稿単位のSNS横断ダッシュボードを、パスワード入力後だけブラウザ内で復号して表示する静的ページです。

## 公開対象

GitHub Pagesの公開元は `main` ブランチの `/docs` にします。

- `docs/index.html`: 暗号化済みの単一HTML
- `docs/.nojekyll`: Jekyll処理を無効化

元のダッシュボードHTMLはこのリポジトリへコピーしません。Git履歴にも平文を残さないでください。

## 暗号化方式

- 本文暗号化: AES-256-GCM
- 鍵導出: PBKDF2-HMAC-SHA-256（600,000回）
- salt: 16 bytes、ビルドごとにランダム生成
- IV: 12 bytes、ビルドごとにランダム生成
- 外部通信・外部ライブラリ: なし
- 復号後の本文: sandboxed iframe内に表示。元ダッシュボード内部の高さ計測に必要な `allow-same-origin` と、自己完結ランタイムに必要な `allow-scripts` だけを許可

4桁PINは総当たり可能なため、この構成は「URLを知る人への軽い閲覧抑止」です。個人情報や機密情報を置く場合は、長いランダムパスフレーズまたはサーバー側認証へ変更してください。

## 再ビルド

```bash
npm test
npm run build
```

`npm run build` はパスワードを端末から非表示入力し、`docs/index.html` を再生成します。パスワードをコマンドライン引数、ファイル、Git履歴へ入れないでください。

## 公開前チェック

1. `npm test` がすべて成功している。
2. `docs/index.html` に元HTMLの特徴的な文言が残っていない。
3. `docs/` に `index.html` と `.nojekyll` 以外がない。
4. Pagesの公開元が `main` / `docs` になっている。
5. 公開URLで誤入力・正しい入力・再読み込み後の再ロックを確認する。
