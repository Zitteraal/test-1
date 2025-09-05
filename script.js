// Daten für das Training
const trainingData = [
    { input: 1, output: 2 },
    { input: 2, output: 4 },
    { input: 3, output: 6 },
    { input: 4, output: 8 },
    { input: 5, output: 10 },
    { input: 6, output: 12 },
    { input: 7, output: 14 },
    { input: 8, output: 16 },
    { input: 9, output: 18 },
    { input: 10, output: 20 }
];

// Modell erstellen: ein einfaches sequentielles Modell mit einer einzigen Schicht
const model = tf.sequential();
model.add(tf.layers.dense({ units: 1, inputShape: [1] }));

// Modell kompilieren
// 'meanSquaredError' misst den Durchschnitt der quadrierten Fehler (Loss)
// 'sgd' (Stochastic Gradient Descent) ist der Optimierer, der die Gewichte anpasst
model.compile({
    loss: 'meanSquaredError',
    optimizer: 'sgd'
});

// Daten in Tensoren umwandeln, was das Format ist, das TensorFlow.js benötigt
const inputs = tf.tensor2d(trainingData.map(d => d.input), [trainingData.length, 1]);
const outputs = tf.tensor2d(trainingData.map(d => d.output), [trainingData.length, 1]);

// Modell trainieren
async function trainModel() {
    await model.fit(inputs, outputs, {
        epochs: 250, // Anzahl der Durchläufe (Epochen)
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                console.log(`Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}`);
            }
        }
    });
    console.log('Training abgeschlossen!');
    document.getElementById('loading').innerText = 'Modell ist bereit!';
}

// Funktion für die Vorhersage
async function predict() {
    const inputElement = document.getElementById('inputNumber');
    const outputElement = document.getElementById('output');

    const inputVal = parseFloat(inputElement.value);

    // Überprüfe, ob die Eingabe eine gültige Zahl ist
    if (isNaN(inputVal)) {
        outputElement.innerText = 'Bitte eine gültige Zahl eingeben.';
        return;
    }

    // Konvertiere die Eingabe in einen TensorFlow-Tensor
    const inputTensor = tf.tensor2d([inputVal], [1, 1]);

    // Treffe eine Vorhersage mit dem trainierten Modell
    const prediction = model.predict(inputTensor);

    // Extrahiere das Ergebnis aus dem Tensor
    const result = prediction.dataSync()[0];

    // Zeige das Ergebnis auf der Seite an
    outputElement.innerText = `Vorhersage: ${result.toFixed(2)}`;
}

// Starte das Training, sobald die Seite geladen ist
window.onload = trainModel;
