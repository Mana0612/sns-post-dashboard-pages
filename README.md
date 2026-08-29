# SNS投稿ダッシュボード（GitHub Pages公開用）

XとThreadsの直近1か月分を投稿内容で照合し、`両方 / Xのみ / Threadsのみ` に分けたダッシュボードを、パスワード入力後だけブラウザ内で復号して表示する静的ページです。

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
- 復号後の本文: sandboxed iframe内に表示。自己完結ランタイム用の `allow-scripts` と、ユーザーがX・Threadsの投稿リンクを新規タブで開くための `allow-popups allow-popups-to-escape-sandbox` だけを許可。`allow-same-origin` は付与しない。リンクはHTTPSのX・Threads投稿URLへ限定し、`noopener noreferrer` を付与

4桁PINは総当たり可能なため、この構成は「URLを知る人への軽い閲覧抑止」です。個人情報や機密情報を置く場合は、長いランダムパスフレーズまたはサーバー側認証へ変更してください。

## ローカルのデータと平文HTML

リポジトリ外の次のファイルを正本として使います。Git履歴へ平文を入れないでください。

- 比較データ: `../SNS横断ダッシュボード_実データ/2026-08-29_X_Threads_1month_comparison.json`
- 平文HTML: `../SNS横断ダッシュボード_X_Threads1ヶ月実データ版.html`

## 再生成・再ビルド

```bash
npm run generate:dashboard
npm test
npm run build
npm run qa:built
```

- `npm run generate:dashboard`: 比較JSONから平文HTMLを再生成
- `npm test`: 暗号化、モバイルUI、公開ファイル構成を検証
- `npm run build`: パスワードを端末から非表示入力し、`docs/index.html` を再生成
- `npm run qa:built`: 実際の暗号化済みページをスマホ幅で復号し、件数・フィルター・外部通信・画面幅を確認

パスワードをコマンドライン引数、ファイル、Git履歴へ入れないでください。

## 公開前チェック

1. 比較JSONの件数とダッシュボードの `両方 / Xのみ / Threadsのみ` が一致している。
2. `npm test` と `npm run qa:built` が成功している。
3. `docs/index.html` に元HTMLの特徴的な文言が残っていない。
4. `docs/` に `index.html` と `.nojekyll` 以外がない。
5. Pagesの公開元が `main` / `docs` になっている。
6. 公開URLで誤入力・正しい入力・再読み込み後の再ロックを確認する。
