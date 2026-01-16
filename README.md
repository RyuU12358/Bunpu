# Bunpu (分布)

![License](https://img.shields.io/badge/license-MIT-blue.svg)

**Bunpu** is a spreadsheet application specialized for **probability distribution calculations**.  
It allows you to manipulate probability distributions (like Normal, Binomial, Custom) directly as cell values, making complex probabilistic modeling (e.g., Gacha simulation, Pachinko analysis, Risk assessment) intuitive and easy.

**Bunpu**（分布）は、**確率分布の計算**に特化したスプレッドシートアプリです。  
確率分布そのものを一つの「値」としてセルで扱えるため、ガチャの確率計算やパチンコの期待値分析、リスク評価などの複雑な確率モデルを直感的に構築できます。

## 🚀 Demo

**[Try it out here! / デモを試す](https://RyuU12358.github.io/Bunpu/)**

## ✨ Features

- **Distribution as First-Class Citizen**: Handle entire probability distributions in a single cell.
  - `NORM(0, 1)`: Standard Normal Distribution
  - `BINOM(10, 0.5)`: Binomial Distribution
  - `DISCRETE(...)`: Custom Discrete Distribution
- **Distribution Arithmetic**: Add, subtract, multiply, or divide distributions directly.
  - `A1 + B1` (Convolution of distributions)
  - `MAX(A1, B1)` (Maximum distribution)
- **High Performance**: Core calculation engine written in **Rust** (compiled to **WebAssembly**) for blazing fast convolutions.
- **Excel-like Interface**: Familiar spreadsheet UI with formula bar, cell references, and range selection.

## 🛠 Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Core Engine**: Rust, WebAssembly (via `wasm-bindgen`)
- **State Management**: Custom Graph-based Reactivity Engine

## 📦 Installation

To run this project locally:

1. **Clone the repository**

   ```bash
   git clone https://github.com/RyuU12358/Bunpu.git
   cd Bunpu
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Run development server**
   ```bash
   npm run dev
   ```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
