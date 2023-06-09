# ChatGPTのSlackボットをGASで実装
ChatGPTのSlackBotをGoogle App Scriptで実装する方法です。

<img width="530" alt="example-conversation" src="https://user-images.githubusercontent.com/67893773/228461298-60234fec-354d-4d8d-9ada-7a07d48b062b.png">

## 1. GASを作成する
### 1.1 Google SpreadSheetを作成して、AppScriptを開きます<br>
GAS上のコード(Code.gs)に、このリポジトリのCode.jsの内容を貼り付けます。

### 1.2 LibrariesにSlackAppを追加
以下のScriptIDを使って追加してください。<br>
```ScriptID：1on93YOYfSmV92R5q59NpKmsyWIQD8qnoLYk-gkQBI92C58SPyA2x1-bq```

### 1.3 新規デプロイ
ウェブアプリで新規デプロイしてください。「アクセス権」は「誰でも」です。<br>
デプロイしたら、ウェブアプリのURLが発行されるので、後のSlackのEvent Subscriptionの設定で使うので、控えておいてください。<br>
「デプロイを管理」からでも後で、URLは確認できます。<br>


## 2. SlackのAppの設定をします。
以下の項目を設定してSlackのAppを作成してください。Slackのボットの作成の仕方はここでは細かく説明しません。
### 2.1 OAuth & Permissions
以下のBot TokenScopesを設定してください。SlackのAPIを呼び出すための権限です。
- app_mentions:read
- chat:write
- users:read
- channels:history
- groups:history
- im:history
- mpim:history

### 2.2 Event Subscriptionsの設定
有効にして、RequestURLに1.3で取得したURLを貼り付けてください。Verifiedにならないと問題があります。<br>
GASのWeb Appが正常にデプロイされていない可能性があります。<br>
その後、ボットへのメンションを受信するために「Subscribe to bot events」に[app_mention]を追加してください。

## 3. スクリプトの変数の設定
Code.gs内のスクリプト上部にある変数を設定します。以下の手順で取得して設定してコードを保存してください。
```
const SLACK_ACCESS_TOKEN = 'xoxb-xxxxxx';// Slack Bot User OAuth Token
const OPENAI_API_KEY = 'sk-xxxxxx';// OpenAPIから取得したAPI Key
const SPREADSHEET_ID = 'xxxxxxx';// 実行ログを保存するスプレッドシートのID
const SLACK_BOT_USERID = 'Uxxxxxxx';// SLACK_ACCESS_TOKENのBotのUserId
```

### 3.1 SLACK_ACCESS_TOKEN
SlackAppのOAuth&PermissionsのBot User OAuth Tokenを設定

### 3.2 OPENAI_API_KEY
OpenAIのAPI Keysを設定<br>
https://platform.openai.com/account/api-keys

### 3.3 SPREADSHEET_ID
今作成しているGASのスプレッドシートのスプレッドシートIDを設定。<br>
スプレッドシートのURLのhttps://docs.google.com/spreadsheets/d/{この部分}。

### 3.4 SLACK_BOT_USERID
GASのWEBコンソール上でsearchSlackUserId関数を手動で実行してください。<br>
コンソールにボットのユーザーIDが表示されます。それを設定してください。

## 4. トリガーの設定
GASのWEBコンソール上ででcreateMinuteTriggers関数を手動で実行してください。<br>
自動でスケジューラー用のトリガーが作成されます。

## 5 使ってみる
### 5.1 Slackのチャンネルにアプリを入れる
Slackアプリが正常に作成できていたら、チャンネルにボットを招待することができると思います。

### 5.2 ボットにメンションしてみる
では、あながた作ったボットにメンションしてみてください。返事がきたら成功です！
<img width="347" alt="hello-bot" src="https://user-images.githubusercontent.com/67893773/228464957-640d93e5-330b-475e-a928-383721402d40.png">

もしうまくいかない場合には、GASのログや、SpreadSheetに表示されているログを見ていきましょう。


# 機能
## 1. ChatGPTボットに聞ける
ChatGPTボットにメンションすると回答してくれる機能

## 2. ChatGPTボットと会話ができる
スレッド内で、ChatGPTボットにメンションすると会話ができる機能

## 3. 利用履歴ログ
利用履歴はスプレッドシートに保存されています。ただし、本文は保存していません。<br>
誰がいつ、何回、どのくらいの量を使ったのかを記録しています。

# 全体アーキテクチャー
![architecture](https://user-images.githubusercontent.com/67893773/228460737-21fe04d9-7977-40c4-9fa1-20586639052c.png)


# Q&A
## いつ返事が来るの？
正常でしたら、10~20秒程度で返事が来ます。

## もっと早く返事がほしい
GASの構成では限界あるので、しょうがないです。サーバー代は無料なので、許容してください。

## GPT3.5なの？
はい。このボットは現在gpt-3.5-turboのモデルで動いています。<br>
https://platform.openai.com/docs/models/gpt-3-5<br>

## GPT4は使えるの？
使えません。制約があるので、導入していません。検討はしています。<br>
https://platform.openai.com/docs/models/gpt-4<br>

## 同じ質問をしても回答が変わるのはなぜ？
仕様です。毎回同じ回答させることも可能ですが、少し変わるように設定しています。temperatureを0.3に設定しています。

## スレッドの中の会話は全てChatGPTは認識しているの？
していません。ボットにメンションした内容と、ボットからの返事のみをもとに、ChatGPTは会話を構成しています。ボットにメンションしていない場合は、無視されています。

## 文字数制限はある？
文字数制限（正確にはtoken数の制限）が存在します。4000文字を超える場合には、エラーを出すようにしています。ChatGPTの仕様上、しょうがないです。会話においても、会話の文字数合計4,000文字を超えないように、直近の会話履歴のみを抽出して、ChatGPTに問い合わせをしています。つまりこの場合は会話（スレッド）の前半はChatGPTは知りません。

## 投稿内容を修正した場合は？
ボットへのメンションをつけた投稿を、ボットから返事が来る前に変更した場合は、変更後の投稿内容をもとに、ChatGPTに問い合わせを行います。ただし、タイミングが悪いと、変更前と変更後の両方に対して、ChatGPTから返事が来る可能性があります。

## 返事が来ないよ
ボットのバグなのか、ChatGPTのバグなのか切り分ける必要があります。管理者にお問い合わせください。

# セキュリティについて
## OpenAI
このボットとの会話内容は、OpenAIではトレーニングには用いません。ただし、30日間は不正利用を検知するために、保持されています。<br>
以下OpenAIのデータ利用規約を抜粋<br>
https://openai.com/policies/api-data-usage-policies
```
Starting on March 1, 2023, we are making two changes to our data usage and retention policies:

OpenAI will not use data submitted by customers via our API to train or improve our models, unless you explicitly decide to share your data with us for this purpose. You can opt-in to share data.
Any data sent through the API will be retained for abuse and misuse monitoring purposes for a maximum of 30 days, after which it will be deleted (unless otherwise required by law).
```

## ボット
ボットでは利用履歴やアプリのログをスプレッドシートに保存していますが、会話内容は保存していません。
