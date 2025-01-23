import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const openaiApiKey = process.env.OPENAI_API_KEY;
const assistantId = process.env.ASSISTANT_ID;
const openai = new OpenAI({ apiKey: openaiApiKey });
const app = express();
const port = 3000;

app.use(express.json());

app.post("/interview", async (req, res) => {
  const { level, language, specialty } = req.body;

  if (!level || !language || !specialty) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `Я ${level} разработчик, програмирую на ${language}. Моя специальность ${specialty}. Сгенерируйте 30 вопросов для собеседования учитывая мой уровень и мою специаьность и язык.`,
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

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
