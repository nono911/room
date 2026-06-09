// test-agent.js
// A mock local CLI agent that reads input JSON from stdin and prints response to stdout.

let input = '';
process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const promptPreview = payload.prompt.split('\n')[0]; // first line
    const responseText = `[Success! Hello from Local Agent on your Mac]
Received Prompt (first line): "${promptPreview}"
System Instruction received: Yes (${payload.systemInstruction ? payload.systemInstruction.length : 0} chars)`;
    console.log(responseText);
  } catch (err) {
    console.log(`[Error in Test Local Agent]: ${err.message}. Raw input was: ${input}`);
  }
});
