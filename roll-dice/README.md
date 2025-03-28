# 🎲 Roll Dice

Simple dice rolling application using Ephemeral Rollups to demonstrate using a verifiable random function (VRF) to generate random numbers.

# Demo

<img width="508" alt="Screenshot 2025-03-27 at 18 48 50" src="https://github.com/user-attachments/assets/8b67fd33-c9b4-48f1-9a1a-92a9e8d74111" />

[https://roll-dice-demo.vercel.app/](https://roll-dice-demo.vercel.app//)   

## ✨ Build and Test

Build the program:

```bash
anchor build
```

Run the tests:

```bash
anchor test --skip-deploy --skip-build --skip-deploy
```

## 🚀 Launch the Frontend

To start the frontend application locally:

```bash
cd roll-dice/app
```

Install dependencies:

```bash
yarn install
```

Start the development server:

```bash
yarn dev
```

The application will be available at `http://localhost:3000` (or another port if 3000 is already in use).
