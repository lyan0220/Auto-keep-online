/**
 * @typedef {object} Env
 * @property {string} [URLS] 24 小时访问 URL 列表（逗号或换行符分隔，文本/机密类型）
 * @property {string} [WEBSITES] 指定时间段访问 WEBSITES 列表（逗号或换行符分隔，文本/机密类型）
 * @property {string} [TG_TOKEN] Telegram Bot Token (文本/机密类型)
 * @property {string} [TG_ID] Telegram User/Chat ID (文本/机密类型)
 */

// 此js为cloudflared workers使用，复制整个代码到新建的workers里，修改需要访问的链接或部署后添加环境变量
// 在设置---触发事件 里设置访问频率，例如2分钟，保存即可，可开启日志查看，检查是否运行

// Telegram配置(不需要可忽略)
const TELEGRAM_ID = ""; // 可在此处填写，或通过环境变量TG_ID设置
const TELEGRAM_TOKEN = ""; // 可在此处填写，或通过环境变量TG_TOKEN设置

// 24小时不间断访问的URL数组,可添加环境变量URLS，多个URL用英文逗号或换行分隔
const defaultUrls = [
  "https://www.bing.com", // 可添加多个URL，每个URL之间用英文逗号分隔
  "https://www.bing.com"
  // ... 添加更多URL
];

// 排除时间段(1:00～5:00)访问的URL数组,可添加环境变量WEBSITES，多个URL用英文逗号或换行分隔
const defaultWebsites = [
  "https://www.baidu.com", // 可添加多个URL，每个URL之间用英文逗号分隔
  "https://www.baidu.com"
  // ... 添加更多URL
];

// 检查是否在暂停时间内 (1:00-5:00)
function isInPauseTime(hour) {
  return hour >= 1 && hour < 5;
}

/**
 * 发送消息到Telegram
 * @param {string} message 消息内容
 * @param {Env} env 环境变量对象
 */
async function sendToTelegram(message, env) {
  // 从环境变量（文本/机密类型）或常量中获取Telegram令牌和聊天ID
  const CHAT_TOKEN = env.TG_TOKEN || TELEGRAM_TOKEN;
  const CHAT_ID = env.TG_ID || TELEGRAM_ID;

  if (!CHAT_TOKEN || !CHAT_ID) {
    console.log("未配置Telegram推送，跳过发送消息");
    return;
  } // 构建Telegram API的URL和请求体

  const url = `https://api.telegram.org/bot${CHAT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id: CHAT_ID,
    text: message,
  });

  try {
    // 发送POST请求到Telegram API
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }); // 检查响应状态，如果请求失败则记录错误

    if (!response.ok) {
      console.error(`Telegram推送失败: ${response.statusText}`);
    }
  } catch (error) {
    // 捕获并记录请求过程中可能出现的错误
    console.error(`Telegram推送出错: ${error.message}`);
  }
}

// 生成随机IP地址
function getRandomIP() {
  return `${Math.floor(Math.random() * 255)}.${Math.floor(
    Math.random() * 255
  )}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

/**
 * 生成一个随机Chrome版本号
 * @returns {number} 返回一个介于100到131之间的随机整数，表示Chrome版本号
 */
function getRandomVersion() {
  const chromeVersion = Math.floor(Math.random() * (131 - 100 + 1)) + 100;
  return chromeVersion;
}

// 获取随机 User-Agent
function getRandomUserAgent() {
  const agents = [
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${getRandomVersion()}.0.0.0 Safari/537.36`,
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${getRandomVersion()}.0.0.0 Safari/537.36`,
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/${getRandomVersion()}.0.0.0`,
    `Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1`,
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

/**
 * 执行HTTP请求并处理重试
 * @param {string} url 目标 URL
 * @param {number} index URL 索引
 * @param {Env} env 环境变量对象
 * @param {number} retryCount 重试次数
 */
async function axiosLikeRequest(url, index, env, retryCount = 0) {
  try {
    // 随机延迟 1-6 秒
    await new Promise((resolve) =>
      setTimeout(resolve, 1000 + Math.random() * 5000)
    );

    const config = {
      method: "get",
      headers: {
        "User-Agent": getRandomUserAgent(),
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "X-Forwarded-For": getRandomIP(),
        "X-Real-IP": getRandomIP(),
        Origin: "https://glitch.com",
        Referer: "https://glitch.com/",
      },
      redirect: "follow",
      timeout: 30000,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout);

    const response = await fetch(url, {
      ...config,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const status = response.status;
    const timestamp = new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Hong_Kong",
    });

    if (status !== 200) {
      // 非200状态码发送通知
      await sendToTelegram(
        `保活日志：${timestamp}\n访问失败: ${url}\n状态码: ${status}`,
        env
      );
    }

    return {
      index,
      url,
      status,
      success: status === 200,
      timestamp,
    };
  } catch (error) {
    if (retryCount < 2) {
      // 如果出错且重试次数小于2，等待后重试
      await new Promise((resolve) => setTimeout(resolve, 10000)); // 将 env 参数传递给重试调用
      return axiosLikeRequest(url, index, env, retryCount + 1);
    }
    const timestamp = new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Hong_Kong",
    }); // 发送错误通知
    await sendToTelegram(
      `保活日志：${timestamp}\n访问出错: ${url}\n错误信息: ${error.message}`,
      env
    );
    console.error(`${timestamp} 访问失败: ${url} 状态码: 500`);
    return {
      index,
      url,
      status: 500,
      success: false,
      timestamp,
    };
  }
}

/**
 * 通用 URL 列表解析函数，支持逗号或换行符分隔
 * @param {string} rawUrls 原始 URL 字符串
 * @returns {string[]} 解析后的 URL 数组
 */
function parseUrls(rawUrls) {
  if (!rawUrls) return [];
  return rawUrls
    .replace(/\r?\n/g, ",")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

/**
 * 处理定时任务的入口
 * @param {Env} env 环境变量对象
 */
async function handleScheduled(env) {
  console.log("定时任务开始执行了！");
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" })
  );
  const hour = now.getHours();

  const envUrls = parseUrls(env.URLS);
  const urls = [...defaultUrls, ...envUrls]; // 24小时访问的URL列表

  const envWebsites = parseUrls(env.WEBSITES);
  const websites = [...defaultWebsites, ...envWebsites]; // 指定时间段访问的URL列表

  const results = await Promise.all(
    urls.map((url, index) => axiosLikeRequest(url, index, env))
  ); // 按原始顺序排序并打印结果

  results
    .sort((a, b) => a.index - b.index)
    .forEach((result) => {
      if (result.success) {
        console.log(`${result.timestamp} 访问成功: ${result.url}`);
      } else {
        console.error(
          `${result.timestamp} 访问失败: ${result.url} 状态码: ${result.status}`
        );
      }
    }); // 检查是否在暂停时间

  if (!isInPauseTime(hour)) {
    const websiteResults = await Promise.all(
      websites.map((url, index) => axiosLikeRequest(url, index, env))
    );

    websiteResults
      .sort((a, b) => a.index - b.index)
      .forEach((result) => {
        if (result.success) {
          console.log(`${result.timestamp} 访问成功: ${result.url}`);
        } else {
          console.error(
            `${result.timestamp} 访问失败: ${result.url} 状态码: ${result.status}`
          );
        }
      });
  } else {
    console.log(`当前处于暂停时间 1:00-5:00 --- ${now.toLocaleString()}`);
  }
}

// *** 使用模块化格式的入口点 ***
export default {
  async fetch(request, env, ctx) {
    // HTTP 请求处理函数
    return new Response("Worker is running!", {
      headers: { "content-type": "text/plain" },
    });
  },

  async scheduled(event, env, ctx) {
    // 定时任务处理函数
    // ctx.waitUntil 确保任务在 Worker 休眠前完成
    ctx.waitUntil(handleScheduled(env));
  },
};
