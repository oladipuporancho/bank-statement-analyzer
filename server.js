const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

async function parseBankStatement(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  let data;

  try {
    data = await pdfParse(dataBuffer);
  } catch (error) {
    console.error("Error parsing PDF file:", error);
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }

  const lines = data.text.split("\n").filter(line => line && line.trim() !== "");

  let transactions = [];
  let accountHolder = "Unknown";
  let accountNumber = "Unknown";
  let openingBalance = "NGN 0.00";
  let closingBalance = "NGN 0.00";
  let statementPeriod = "Unknown";
  let currentDate = "Unknown";
  let lastBalance = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.includes("Wallet Statement")) {
      accountHolder = lines[i + 1]?.trim() || "Unknown";
    }
    if (line.includes("Account Number")) {
      accountNumber = line.match(/\d+/)?.[0] || "Unknown";
    }
    if (line.includes("Opening Balance")) {
      openingBalance = `NGN ${line.match(/([\d,]+\.\d{2})/)?.[1] || "0.00"}`;
    }
    if (line.includes("Closing Balance")) {
      closingBalance = `NGN ${line.match(/([\d,]+\.\d{2})/)?.[1] || "0.00"}`;
    }
    if (line.includes("Statement Period")) {
      statementPeriod = lines[i + 1]?.trim() || "Unknown";
    }

    if (/^\w+ \d{1,2}, \d{4}$/.test(line)) {
      currentDate = line;
    }

    if (/\d{1,2}:\d{2}:\d{2}/.test(line) && line.includes("NGN")) {
      try {
        const timeMatch = line.match(/(\d{1,2}:\d{2}:\d{2})/);
        const amountPattern = /NGN\s*([\d,]+\.\d{2})/g;
        let amountMatches = [];
        let match;

        while ((match = amountPattern.exec(line)) !== null) {
          amountMatches.push(parseFloat(match[1].replace(/,/g, "")));
        }

        if (amountMatches.length >= 2) {
          const amount = amountMatches[1];
          let balance = amountMatches[0];
          lastBalance = balance;

          const isCredit = line.toLowerCase().includes("credit") || amount > balance;
          const transactionRefMatch = line.match(/TXT-(\d+)/);
          const transactionRef = transactionRefMatch ? `TXT-${transactionRefMatch[1]}` : "Unknown";
          const description = line.replace(timeMatch[0], "").replace(/NGN [\d,]+\.\d{2}/g, "").trim();
          const toFrom = description.split("/")[0].trim();

          transactions.push({
            date: currentDate !== "Unknown" ? currentDate : "2025-03-05",
            time: timeMatch ? timeMatch[1] : "Unknown",
            type: isCredit ? "Debit" : "Credit",
            amount: `NGN ${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
            balance: lastBalance !== null ? `NGN ${lastBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : closingBalance,
            category: "Wallet",
            to_from: toFrom,
            description: description,
            transaction_reference: transactionRef
          });
        }
      } catch (error) {
        console.error("Error parsing transaction line:", error, line);
      }
    }
  }

  return {
    account_holder: accountHolder,
    account_number: accountNumber,
    opening_balance: openingBalance,
    closing_balance: closingBalance,
    statement_period: statementPeriod,
    transactions
  };
}

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const filePath = path.join(__dirname, "uploads", req.file.filename);
    const statementData = await parseBankStatement(filePath);
    res.json(statementData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
