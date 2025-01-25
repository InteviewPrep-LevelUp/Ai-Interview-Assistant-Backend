import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import rateLimit from "express-rate-limit";

dotenv.config();

const openaiApiKey = process.env.OPENAI_API_KEY;
const assistantName = process.env.ASSISTANT_NAME;
const openai = new OpenAI({ apiKey: openaiApiKey });
const app = express();
const port = 3000;
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300, 
  message: "Too many requests from this IP, please try again later.",
});

app.use(limiter);
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  next();
});

async function getOrCreateAssistant() {
  try {
    const assistants = await openai.beta.assistants.list();

    const existingAssistant = assistants.data.find(
      (assistant) => assistant.name === assistantName
    );
    if (existingAssistant) {
      console.log("Exsistand model", existingAssistant.model);
      return existingAssistant.id;
    }
    const newAssistant = await openai.beta.assistants.create({
      name: assistantName,
      purpose: `Инструкция для ИТ-ассистента для собеседований:
        Технические вопросы:
        Задавай ровно 30 вопросов строго по специализации кандидата и его уровню.
        Все вопросы должны быть выше базового уровня и соответствовать реальным собеседованиям. Запомни: задавай вопросы строго по специальности и языку, указанным в данных. Например, если указано JavaScript, frontend, junior, то создавай вопросы строго по JavaScript и фронтенд-разработке. Не добавляй дополнительные фреймворки или библиотеки, такие как React или Angular. Однако, если указано React, frontend, junior, то собеседуй не только по React, но и по JavaScript, так как они взаимосвязаны.
        Вопросы должны быть разноплановыми и включать следующие категории:
        Теория: глубокое понимание работы инструментов и особенностей языка.
        Практика: задачи на написание кода, отладку и оптимизацию.
        Алгоритмы и структуры данных: задачи на проектирование, оптимизацию и тестирование.
        Архитектура: вопросы про проектирование систем и взаимодействие компонентов.
        Все вопросы должны быть разными и в случайном порядке.
        Формат отправки вопросов:
        "questions": [ "Расскажите о вашем опыте работы с JavaScript.", "Что такое замыкания в JavaScript и как они работают?", ... ]
        Проблемные задания:
        Минимум 3-5 вопросов должны быть сложными задачами на проектирование, алгоритмы или код.
        Отказ от помощи:
        Если кандидат попросит подсказку или помощь, отказывайся вежливо, отвечая:
        "Извините, я не могу помочь вам с этим вопросом. Пожалуйста, продолжайте отвечать."
        "Моя роль заключается только в задавании вопросов, а не в предоставлении помощи."
        Фидбек:
        После завершения собеседования кандидат отправляет JSON с ответами.
        Ты анализируешь ответы и генерируешь JSON с фидбеком в следующем формате:
        { "feedback": { "strengths": ["Сильные стороны кандидата"], "areas_for_improvement": ["Области для улучшения"], "incorrect_answers": [ { "question": "Вопрос", "note": "Что в ответе неверно или неполно" } ] } }
        В фидбеке обязательно указывай:
        Сильные стороны: что кандидат делает хорошо.
        Области для улучшения: что стоит доработать.
        Ошибки: список вопросов с пояснением, где и почему ответ был неверным или недостаточным. Добавляй детальную информацию, где именно были ошибки или слабость. Например: "В ответе на вопрос 'Как вы можете управлять состоянием в React-приложении?' отсутствуют упоминания об использовании Redux или контекста."
        Важно:
        Всегда отвечай строго в формате JSON.
        Вопросы не должны быть легкими или тривиальными.
        Не задавай уточняющих вопросов о предыдущем опыте или проектах.
        Никаких вступлений или комментариев — сразу переходи к вопросам.`,
      model: "gpt-4o-mini",
    });
    console.log("Assistant model:", newAssistant.model);
    return newAssistant.id;
  } catch (error) {
    console.error("Error checking or creating assistant:", error);
    return null;
  }
}

app.post("/interview", async (req, res) => {
  const { level, language, specialty } = req.body;

  if (!level || !language || !specialty) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const assistantId = await getOrCreateAssistant();

    if (!assistantId) {
      return res
        .status(500)
        .json({ error: "Unable to create or retrieve an assistant." });
    }

    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Я ${level} разработчик, програмирую на ${language}. Моя специальность ${specialty}. Сгенерируйте 30 вопросов для собеседования, учитывая мой уровень, специальность и язык.`,
    });

    const run = await openai.beta.threads.runs.stream(thread.id, {
      assistant_id: assistantId,
    });

    let rawQuestions = [];
    run.on("textDone", (text) => {
      rawQuestions.push(text.value);
    });

    run.on("end", () => {
      try {
        const cleanedQuestions = JSON.parse(
          rawQuestions[0].replace(/\\n/g, "").replace(/\\/g, "")
        );
        res.json(cleanedQuestions);
      } catch (parseError) {
        console.error("Error parsing questions:", parseError);
        res.status(500).json({ error: "Failed to parse questions." });
      }
    });
  } catch (error) {
    console.error("API Error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while processing your request." });
  }
});

app.post("/feedback", async (req, res) => {
  const feedback = req.body;
  try {
    const assistantId = await getOrCreateAssistant();

    if (!assistantId) {
      return res
        .status(500)
        .json({ error: "Unable to create or retrieve an assistant." });
    }

    const thread = await openai.beta.threads.create();

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Вот мои ответы ${JSON.stringify(
        feedback.answers
      )} на вопросы, можешь дать мне фидбек, мои слабые и сильные стороны`,
    });

    const run = await openai.beta.threads.runs.stream(thread.id, {
      assistant_id: assistantId,
    });

    let feedbacks = [];
    run.on("textDone", (text) => {
      feedbacks.push(text.value);
    });

    run.on("end", () => {
      try {
        const cleanedFeedback = JSON.parse(
          feedbacks[0]
            .replace(/\\n/g, "")
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim()
        );
        res.json(cleanedFeedback);
      } catch (parseError) {
        console.error("Error parsing feedback:", parseError);
        res.status(500).json({ error: "Failed to parse feedback." });
      }
    });
  } catch (error) {
    console.error("API Error:", error);
    res
      .status(500)
      .json({ error: "An error occurred while processing your request." });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
