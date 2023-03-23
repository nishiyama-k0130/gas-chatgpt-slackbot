const SLACK_ACCESS_TOKEN = 'xoxb-xxxxxx';// Slack Bot User OAuth Token
const OPENAI_API_KEY = 'sk-xxxxxx';// OpenAPIから取得したAPI Key
const SPREADSHEET_ID = 'xxxxxxx';// 実行ログを保存するスプレッドシートのID
const SLACK_BOT_USERID = 'Uxxxxxxx';// SLACK_ACCESS_TOKENのBotのUserId

/**
 * [手動実行用]
 * SlackのBotのUserIdを取得する関数。メインの処理では使用しない。
 * 自分のBotのUserIdを取得するために使用する。
 * BotのUserIdは画面からはわからずらいので、APIを叩いて取得する。
 */
function searchSlackUserId() {
  const API_URL = 'https://slack.com/api/auth.test';
  const options = {
    'method': 'GET',
    'headers': {
      'Authorization': 'Bearer ' + SLACK_ACCESS_TOKEN
    }
  };
  const response = UrlFetchApp.fetch(API_URL, options);
  const data = JSON.parse(response.getContentText());
  console.log(`Bot UserId=${data.user_id}`);
}

/**
 * [手動実行用]
 * トリガーを一度に複数作成する関数。メインの処理では使用しない。もちろん手動で作成してもOK。
 * トリガー起動で実行可能な時間は、有料アカウントで6時間/日の制限がある。
 * keyがない場合の実行時間は1回平均1秒として1分に6回起動した場合は、
 * 8,640秒/日 = 2.4時間/時間。残りでイベントの処理はできるだろうという見積もり。
 * 1分間に複数回起動する理由は、起動秒数を分散させて、Slackへの返答（イベントの処理）を早く行うためです。
 * {@link https://developers.google.com/apps-script/guides/services/quotas?hl=ja}
 */
function createMinuteTriggers() {
  const TRIGGER_COUNT_PER_MINUTES = 6;
  for (let i = 0; i < TRIGGER_COUNT_PER_MINUTES; i++) {
    ScriptApp.newTrigger('processEvent').timeBased().everyMinutes(1).create();
  }
}

/**
 * [手動実行用]
 * 全てのトリガーを削除する関数。メインの処理では使用しない。
 */
function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
}

/**
 * SlackからのEventリクエストを受け付けるエンドポイント
 * Slackには3秒以内に200を返さないとリトライされる制約があるので、
 * パラメーターはスクリプトプロパティ（ほぼグローバル変数）に保存しておいて、先にSlackに200を返す。
 * この関数はGASのweb appとしてデプロイします。web appの修正の反映には新規にDeployを行う必要があるので注意してください。
 * その場合は新しくURLが発行されているので、SlackのEvent SubscriptionのURLも更新する必要があります。
 * {@link https://developers.google.com/apps-script/guides/web?hl=ja}
 * {@link https://api.slack.com/apis/connections/events-api}
 *
 * @param {GoogleAppsScript.Events.DoPost} e
 */
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const eventType = data.type;

  if (eventType === 'url_verification') {
    // SlackからのURL検証で利用。SlackでEvent Subscriptionを有効にするときに必要。
    log(`Verify URL. challenge=${data.challenge}`);
    return ContentService.createTextOutput(data.challenge);
  }

  if (eventType === 'event_callback') {
    const event = data.event;
    if (event.type === 'app_mention') {
      const scriptProperties = PropertiesService.getScriptProperties();
      const clientMsgId = event.client_msg_id;
      scriptProperties.setProperty(clientMsgId, JSON.stringify(event));
      if (scriptProperties.getProperty(clientMsgId)) {
        log(
          `processEventで処理される前に、同じclientMsgIdで呼ばれました。メンション内容を変更したか、リトライされている可能性があり。 clientMsgId=${clientMsgId}`
        );
      }
      return ContentService.createTextOutput('Register Event.');
    }
  }
  throw new Error(`Unknown eventType=${eventType}, data.event.type=${data.event.type}`);
}

/**
 * トリガー(Time-Driven)で実行される関数。スクリプトプロパティに登録されたイベントを処理する。
 * この関数はweb appとして利用されないので、常に最新のコードが実行されます。
 */
function processEvent() {
  const scriptProperties = PropertiesService.getScriptProperties();
  let keys = scriptProperties.getKeys();
  if (keys?.length > 0) {
    keys = keys.slice(0, 5); // タイムアウト制限があるので、1回の処理は4件まで
    log(`Start processEvent, keys length = ${keys.length}`);
    const events = keys.map((key) => JSON.parse(scriptProperties.getProperty(key)));
    keys.forEach((key) => scriptProperties.deleteProperty(key));
    events.forEach((e) => usecase(e));
  } else {
    console.log('Start processEvent, but no target to process.');
  }
}

/**
 * メイン処理。投稿内容をもとに、ChatGPTを呼び出して、スレッドに返信をします。
 * 結果をスプレッドシートにも保存します。
 *
 * @param {*} event
 */
function usecase(event) {
  if (!event) {
    log('event is undefined.');
    return;
  }
  log(`Start usecase: user=${event.user}, channel=${event.channel}, ts=${event.ts}, thread_ts=${event.thread_ts}`);
  const channelId = event.channel;

  let conversationHistory = [];
  if (event.thread_ts) {
    // スレッド内でメンションされた場合
    conversationHistory = getThreadConversationHistory(channelId, event.thread_ts);
  }

  try {
    const messages = generateChatGPTMessages(conversationHistory, event.text);
    const gptResponse = callChatGptApi(messages);
    log(`Success to call ChatGPT, user=${event.user}, ts=${event.ts}, usage=${JSON.stringify(gptResponse.usage)}`);
    postSlackMessageInThread(channelId, gptResponse.choices[0].message.content.trim(), event.ts);
    addUserUsageInSpreadSheet(event.user, gptResponse.usage.total_tokens);
    log(`Finish, user=${event.user}, ts=${event.ts}`);
  } catch (error) {
    log(error);
    postSlackMessageInThread(channelId, `Error at asking ChatGPT, error=${error}`);
  }
}

/**
 * Slackのスレッドの会話履歴を取得します。
 * このSlack APIには channel:history, groups:history, im:history, mpim:history というBot Token Scopesの権限が必要です。
 * {@link https://api.slack.com/methods/conversations.replies}
 *
 * @param {string} channelId
 * @param {string} threadTs
 * @returns {Array<{*}>}
 */
function getThreadConversationHistory(channelId, threadTs) {
  const url = `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${threadTs}`;
  const options = {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + SLACK_ACCESS_TOKEN,
      'Content-Type': 'application/json; charset=utf-8',
    },
  };
  const response = UrlFetchApp.fetch(url, options);
  const jsonResponse = JSON.parse(response.getContentText());
  if (!jsonResponse.ok) {
    log(jsonResponse.response_metadata?.messages);
    throw new Error(jsonResponse.error);
  }
  if (jsonResponse.messages) {
    return jsonResponse.messages;
  } else {
    return [];
  }
}

/**
 * ChatGPTに送るために、メッセージを生成します。
 * 会話のコンテキストを伝えるために、履歴をmessagesに追加します。
 * ただし、文字数が多い場合には、直近の会話のみを追加します。
 * {@link https://platform.openai.com/docs/guides/chat/introduction}
 *
 * @param {Array<{*}>} conversationHistory
 * @param {string} prompt
 * @returns {Array<{role:string, content:string}>}
 */
function generateChatGPTMessages(conversationHistory, prompt) {
  const messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant.',
    },
  ];

  if (conversationHistory.length === 0) {
    // スレッド内でのメンションでないケース
    messages.push({ role: 'user', content: prompt });
  } else {
    // 会話のコンテキストを伝えるために、履歴をmessagesに追加
    // promptに該当するメッセージはconversationHistoryに含まれているので、promptは追加しない
    conversationHistory.forEach(function (message) {
      let role = '';
      if (message.user === SLACK_BOT_USERID) {
        role = 'assistant';
      } else if (message.text.indexOf(`<@${SLACK_BOT_USERID}>`) !== -1) {
        // Botにmentionしていない場合はスキップ
        role = 'user';
      }
      if (role !== '') {
        messages.push({ role: role, content: message.text });
      }
    });
  }

  // メッセージ中からSLACK_BOT_USERIDを削除
  messages.forEach(function (message) {
    message.content = message.content.replace(`<@${SLACK_BOT_USERID}>`, '').trim();
  });

  /**
   * tokenの最大値(4096)を超す可能性があるため、contentの文字数の合計が4000文字を超える場合は直近の会話のみを残す
   * この4000という数字のは大きな根拠はない。token数の自前でのカウントは困難である。
   * OpenAIによると普通の英語なら100文字が75token程度であるとのこと（1単語1トークン）。
   * 一方で日本語は1文字1トークン以上で、漢字は3トークンになることもある。
   * なので、4000という暫定数値はは日本語のみで考えた場合の最大文字数である。
   */
  let totalLength = 0;
  let i = messages.length - 1;
  const MAX_CHAR_LENGTH = 4000;
  while (i >= 0 && totalLength + messages[i].content.length <= MAX_CHAR_LENGTH) {
    totalLength += messages[i].content.length;
    i--;
  }
  if (i >= 0) {
    log(`Too many big messages, messages.length=${messages.length}, removed=${i + 1}`);
    messages.splice(0, i + 1);
    if (messages.length === 0) {
      throw new Error(`Too many characters, keep it under ${MAX_CHAR_LENGTH}.`);
    }
  }

  return messages;
}

/**
 * Chat GPTに問い合わせを行います。
 * {@link https://platform.openai.com/docs/api-reference/chat}
 *
 * @param {Array<{role:string, content:string}>} messages
 * @returns ChatGPTのレスポンス
 */
function callChatGptApi(messages) {
  const url = 'https://api.openai.com/v1/chat/completions';
  const headers = {
    Authorization: 'Bearer ' + OPENAI_API_KEY,
    'Content-Type': 'application/json',
  };

  const data = {
    model: 'gpt-3.5-turbo',
    messages: messages,
    //'max_tokens': 4096, 初期値は最大値
    n: 1,
    stop: null,
    temperature: 0.3,
  };
  const options = {
    method: 'post',
    headers: headers,
    payload: JSON.stringify(data),
  };

  const response = UrlFetchApp.fetch(url, options);
  const gptResponse = JSON.parse(response.getContentText());
  return gptResponse;
}

/**
 * SlackのThreadに投稿します。
 * このSlack APIには chat:write というBot Token Scopesの権限が必要です。
 * {@link https://api.slack.com/methods/chat.postMessage}
 *
 * @param {string} channelId
 * @param {string} message
 * @param {string} ts
 */
function postSlackMessageInThread(channelId, message, ts) {
  const url = 'https://slack.com/api/chat.postMessage';
  const options = {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + SLACK_ACCESS_TOKEN,
      'Content-Type': 'application/json; charaset=utf-8;',
    },
    payload: JSON.stringify({
      channel: channelId,
      text: message,
      thread_ts: ts,
    }),
  };
  UrlFetchApp.fetch(url, options);
}

/**
 * スプレッドシートにユーザーの使用量をログとして追加します。
 * {@link https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app?hl=en}
 *
 * @param {string} userId
 * @param {number} totalTokens
 */
function addUserUsageInSpreadSheet(userId, totalTokens) {
  const now = new Date();
  // シート名のために現在日時から年月を取得
  const yearMonth = Utilities.formatDate(now, 'Asia/Tokyo', 'YYYYMM');

  // 年月のシートを取得。存在しなければ作成する
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetName = `${yearMonth}_UseLog`;
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (sheet == null) {
    sheet = spreadsheet.insertSheet(sheetName);
    // ヘッダー追加
    sheet.appendRow([
      'Last Used Time',
      'Slack User ID',
      'User Name',
      'Total Used Tokens',
      'Total Used Count',
    ]);
  }

  // user idが存在する行を検索
  const lastRow = sheet.getLastRow();
  const userIdColumnNo = 2;
  const totalUsedTokensColumnNo = 4;
  const totalUsedCountColumnNo = 5;
  let userIds = [];
  if (lastRow > 1) {
    const userIdRange = sheet.getRange(2, userIdColumnNo, lastRow - 1, 1);
    userIds = userIdRange.getValues();
  }
  let found = false;
  for (let i = 0; i < userIds.length; i++) {
    if (userIds[i][0] === userId) {
      // 既にUserが存在している場合は、Token数と回数を増やす
      const totalUsedTokensRange = sheet.getRange(i + 2, totalUsedTokensColumnNo);
      const totalUsedCountRange = sheet.getRange(i + 2, totalUsedCountColumnNo);
      totalUsedTokensRange.setValue(totalUsedTokensRange.getValue() + totalTokens);
      totalUsedCountRange.setValue(totalUsedCountRange.getValue() + 1);
      found = true;
      break;
    }
  }

  // user idが存在しない場合は新しい行を追加
  if (!found) {
    const newRow = [now, userId, getUserNameById(userId), totalTokens, 1];
    sheet.appendRow(newRow);
  }
}

/**
 * Slackユーザー名を取得します。万が一取得できない場合は、Not solve UserNameを返します。
 * 実験結果としては、Slackのワークスペース外の人を取得しようとすると、ユーザー名が取得できないことがわかりました。
 * このSlack APIには users:read というBot Token Scopesの権限が必要です。
 * ${@link https://api.slack.com/methods/users.info}
 *
 * @param {string} userId
 * @returns {string} Slackユーザー名
 */
function getUserNameById(userId) {
  const url = 'https://slack.com/api/users.info';
  const options = {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + SLACK_ACCESS_TOKEN,
    },
  };
  const response = UrlFetchApp.fetch(url + '?user=' + userId, options);
  const jsonResponse = JSON.parse(response.getContentText());
  if (!jsonResponse.ok) {
    log(jsonResponse);
    return 'Not solve UserName';
  }
  return jsonResponse.user.profile.real_name;
}

/**
 * ログをSpreadSheetとconsole共に出力します。
 * console.logとの使い分けですが、console.logで出力されたものはGoogle Apps Scriptのログに出力されるのですが、一定期間しか保持されないです。
 * そのため、SpreadSheetに出力することで、長期間ログを保持することができます。
 * ですが、さすがにSpreadSheetにpromptを表示するのは情報がダダ漏れなので、長期間残したり、残すべきでない情報はconsole.logで出力することにしています。
 *
 * @param {string} txt
 */
function log(txt) {
  const spreadSheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetName = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMM') + '_AppLog';
  const sheet = spreadSheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadSheet.insertSheet(sheetName);
    sheet.appendRow(['Timestamp', 'Text']);
  }
  sheet.appendRow([new Date(), txt]);
  console.log(txt);
}

/**
 * 以下テスト用
 */
function testUsecaseConv() {
  usercase({
    user: 'U016QSGKYM7',
    text: '<@U04U9JQRZ47> 明日来ていく服の相談にのってください',
    ts: '1679324021.272649',
    channel: 'C04UQ5F6Y6N',
  });
}

function testUsecaseInThread() {
  usecase({
    user: 'U016QSGKYM7',
    text: '<@U04U9JQRZ47> 明日来ていく服の相談にのってください',
    ts: '1679324021.272649',
    thread_ts: '1679402455.370869',
    channel: 'C04UQ5F6Y6N',
  });
}

function testGetThreadConversationHistory() {
  const result = getThreadConversationHistory('C04UQ5F6Y6N', '1679402455.370869');
  console.log(result);
}

function testAddUserUsageInSpreadSheet() {
  addUserUsageInSpreadSheet('U03ENDCGZ0C', 12);
}
