
const $ = (id) => document.getElementById(id);

let regs = Array(32).fill(0);
let mem = {};
let lines = [];
let labels = {};
let pc = 0;
let cycles = 0;
let completed = 0;
let halted = false;
let running = false;
let runToken = 0;

const supported = [
  "ADD", "SUB", "AND", "OR", "ADDI",
  "LW", "SW", "BEQ", "JAL"
];

function setStatus(message, kind = "") {
  const status = $("status");
  if (!status) return;
  status.className = "status " + kind;
  status.textContent = message;
}

function parseProgram() {
  const raw = $("program").value.split(/\n/);
  labels = {};
  lines = [];
  let address = 0;

  for (let rawLine of raw) {
    let instruction = rawLine.split("#")[0].trim();
    if (!instruction) continue;

    while (/^[\w.-]+:/.test(instruction)) {
      const match = instruction.match(/^([\w.-]+):/);
      labels[match[1]] = address;
      instruction = instruction.slice(match[0].length).trim();
      if (!instruction) break;
    }

    if (instruction) {
      lines.push({ pc: address, text: instruction });
      address += 4;
    }
  }
}

function resetState() {
  regs = Array(32).fill(0);
  mem = {};
  pc = 0;
  cycles = 0;
  completed = 0;
  halted = false;

  render();
  setStatus("Program loaded. Ready to execute.", "good");
}

function regIndex(value) {
  const match = value.trim().toLowerCase().match(/^x(\d+)$/);

  if (!match || Number(match[1]) > 31) {
    throw new Error("Invalid register: " + value);
  }

  return Number(match[1]);
}

function numberValue(value) {
  value = String(value).trim();

  if (Object.prototype.hasOwnProperty.call(labels, value)) {
    return labels[value];
  }

  const result = Number(value);

  if (!Number.isFinite(result)) {
    throw new Error("Invalid number or label: " + value);
  }

  return result;
}

function parseInstruction(text) {
  const parts = text.trim()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .split(" ");

  const op = parts[0].toUpperCase();
  const args = parts.slice(1);

  if (!supported.includes(op)) {
    throw new Error("Unsupported instruction: " + op);
  }

  if (["ADD", "SUB", "AND", "OR"].includes(op)) {
    if (args.length !== 3) {
      throw new Error(op + " requires rd, rs1, rs2");
    }

    return {
      op,
      rd: regIndex(args[0]),
      rs1: regIndex(args[1]),
      rs2: regIndex(args[2])
    };
  }

  if (op === "ADDI") {
    if (args.length !== 3) {
      throw new Error("ADDI requires rd, rs1, immediate");
    }

    return {
      op,
      rd: regIndex(args[0]),
      rs1: regIndex(args[1]),
      imm: numberValue(args[2])
    };
  }

  if (op === "LW" || op === "SW") {
    if (args.length !== 2) {
      throw new Error(op + " requires register, offset(base)");
    }

    const match = args[1].match(
      /^(-?(?:0x[\da-f]+|\d+))?\((x\d+)\)$/i
    );

    if (!match) {
      throw new Error("Use memory format such as 4(x2)");
    }

    return {
      op,
      reg: regIndex(args[0]),
      imm: match[1] ? numberValue(match[1]) : 0,
      base: regIndex(match[2])
    };
  }

  if (op === "BEQ") {
    if (args.length !== 3) {
      throw new Error("BEQ requires rs1, rs2, target");
    }

    return {
      op,
      rs1: regIndex(args[0]),
      rs2: regIndex(args[1]),
      target: numberValue(args[2])
    };
  }

  if (op === "JAL") {
    if (args.length !== 2) {
      throw new Error("JAL requires rd, target");
    }

    return {
      op,
      rd: regIndex(args[0]),
      target: numberValue(args[1])
    };
  }
}

function getControls(instruction) {
  const op = instruction.op;

  return {
    RegWrite: [
      "ADD", "SUB", "AND", "OR",
      "ADDI", "LW", "JAL"
    ].includes(op) ? 1 : 0,

    ALUSrc: ["ADDI", "LW", "SW"].includes(op) ? 1 : 0,
    MemRead: op === "LW" ? 1 : 0,
    MemWrite: op === "SW" ? 1 : 0,
    MemtoReg: op === "LW" ? 1 : 0,
    Branch: op === "BEQ" ? 1 : 0,

    "ALU operation": ({
      ADD: "ADD",
      SUB: "SUB",
      AND: "AND",
      OR: "OR",
      ADDI: "ADD",
      LW: "ADD",
      SW: "ADD",
      BEQ: "SUB",
      JAL: "PC + 4"
    })[op]
  };
}

function execute() {
  if (halted) {
    setStatus("Program finished. Reset to run again.", "warn");
    return;
  }

  const entry = lines.find(item => item.pc === pc);

  if (!entry) {
    halted = true;
    setStatus("Program finished at PC " + pc + ".", "good");
    render(false);
    return;
  }

  try {
    const instruction = parseInstruction(entry.text);
    const op = instruction.op;
    const oldPC = pc;

    let result = 0;
    let nextPC = pc + 4;
    let description = "";
    let rs1Value = 0;
    let rs2Value = 0;

    const activeBlocks = ["bPC", "bIM", "bCU", "bRF"];
    const signals = getControls(instruction);

    if (instruction.rs1 !== undefined) {
      rs1Value = regs[instruction.rs1];
    }

    if (instruction.rs2 !== undefined) {
      rs2Value = regs[instruction.rs2];
    }

    if (op === "ADD") result = rs1Value + rs2Value;
    if (op === "ADDI") result = rs1Value + instruction.imm;
    if (op === "SUB" || op === "BEQ") {
      result = rs1Value - rs2Value;
    }
    if (op === "AND") result = rs1Value & rs2Value;
    if (op === "OR") result = rs1Value | rs2Value;

    if (op === "LW" || op === "SW") {
      result = regs[instruction.base] + instruction.imm;
    }

    if (["ADD", "SUB", "AND", "OR", "ADDI"].includes(op)) {
      if (instruction.rd !== 0) {
        regs[instruction.rd] = result;
      }

      description = instruction.rd === 0
        ? "x0 remains zero"
        : "x" + instruction.rd + " = " + result;

      activeBlocks.push("bALU", "bWB");
    } else if (op === "SW") {
      mem[result] = regs[instruction.reg];
      description = "Memory[" + result + "] = " + regs[instruction.reg];
      activeBlocks.push("bALU", "bDM");
    } else if (op === "LW") {
      const value = mem[result] ?? 0;

      if (instruction.reg !== 0) {
        regs[instruction.reg] = value;
      }

      description = "x" + instruction.reg + " = " + value;
      activeBlocks.push("bALU", "bDM", "bWB");
    } else if (op === "BEQ") {
      const branchTaken = rs1Value === rs2Value;

      if (branchTaken) nextPC = instruction.target;

      description = "Branch " + (branchTaken ? "taken" : "not taken");
      activeBlocks.push("bALU", "bNext");
    } else if (op === "JAL") {
      if (instruction.rd !== 0) {
        regs[instruction.rd] = pc + 4;
      }

      nextPC = instruction.target;
      description = "Jump to PC " + nextPC;
      activeBlocks.push("bWB", "bNext");
    }

    regs[0] = 0;
    pc = nextPC;
    cycles++;
    completed++;

    updateText("pcval", "PC = " + oldPC);
    updateText("instval", entry.text);
    updateText("regval", "rs1: " + rs1Value + " / rs2: " + rs2Value);
    updateText("aluval", result);
    updateText("wbval", description);
    updateText("nextpc", "Next PC = " + pc);

    updateText(
      "memval",
      op === "LW" ? "Read " + (mem[result] ?? 0) :
      op === "SW" ? "Write " + mem[result] :
      "Not used"
    );

    document.querySelectorAll(".block").forEach(block => {
      block.classList.remove("active");
    });

    activeBlocks.forEach(id => {
      if ($(id)) $(id).classList.add("active");
    });

    const signalTable = $("signals");

    if (signalTable) {
      signalTable.innerHTML =
        "<tr><th>Control signal</th><th>Value</th></tr>" +
        Object.entries(signals).map(([name, value]) =>
          "<tr><td>" + escapeHTML(name) +
          "</td><td><strong>" + escapeHTML(value) +
          "</strong></td></tr>"
        ).join("");
    }

    addLog(cycles, oldPC, entry.text + " → " + description);
    render(false);

    setStatus(
      "Cycle " + cycles + ": " + entry.text + " — " + description,
      "good"
    );
  } catch (error) {
    halted = true;
    setStatus("Error at PC " + pc + ": " + error.message, "warn");
  }
}

function updateText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function addLog(cycle, address, message) {
  const log = $("log");
  if (!log) return;

  const row = document.createElement("tr");

  [cycle, address, message].forEach(value => {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.appendChild(cell);
  });

  log.prepend(row);
}

function render(clearLog = true) {
  updateText("cycle", cycles);
  updateText("pcMetric", pc);
  updateText("doneMetric", completed);

  const registerTable = $("registers");

  if (registerTable) {
    let html = "";

    for (let i = 0; i < 16; i++) {
      html +=
        "<tr><td>x" + i + "</td><td>" + regs[i] +
        "</td><td>x" + (i + 16) + "</td><td>" +
        regs[i + 16] + "</td></tr>";
    }

    registerTable.innerHTML = html;
  }

  const memoryTable = $("memory");

  if (memoryTable) {
    const entries = Object.entries(mem)
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    memoryTable.innerHTML = entries.length
      ? entries.map(([address, value]) =>
          "<tr><td>" + address + "</td><td>" + value +
          "</td><td>Word at address " + address + "</td></tr>"
        ).join("")
      : '<tr><td colspan="3">No memory writes yet.</td></tr>';
  }

  if (clearLog && $("log")) {
    $("log").innerHTML = "";
  }

  updateText("pcval", "PC = " + pc);
}

function stopRun() {
  running = false;
  runToken++;
}

function loadProgram() {
  stopRun();

  try {
    parseProgram();

    if ($("log")) $("log").innerHTML = "";

    resetState();
  } catch (error) {
    setStatus(error.message, "warn");
  }
}

function runProgram() {
  if (running) return;

  running = true;
  const token = ++runToken;

  async function loop() {
    while (running && token === runToken && !halted) {
      execute();

      const speed = $("speed")
        ? Number($("speed").value)
        : 250;

      await new Promise(resolve => setTimeout(resolve, speed));
    }

    if (token === runToken) running = false;
  }

  loop();
}

function initialise() {
  if ($("load")) $("load").addEventListener("click", loadProgram);

  if ($("reset")) {
    $("reset").addEventListener("click", () => {
      stopRun();
      resetState();
    });
  }

  if ($("step")) {
    $("step").addEventListener("click", () => {
      stopRun();
      execute();
    });
  }

  if ($("run")) {
    $("run").addEventListener("click", runProgram);
  }

  parseProgram();
  resetState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialise);
} else {
  initialise();
}
