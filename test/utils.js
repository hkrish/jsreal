

expect.extend({
    arrayCloseTo (received, expected, tol) {
        tol = (tol == null) ? 1e-10 : tol;
        if (!(Array.isArray(received) && Array.isArray(expected))) {
            return {
                pass: false,
                message: () => 'Expected received and expected to be Arrays',
            };
        }
        let nr = received.length;
        let ne = expected.length;
        if (nr !== ne) {
            return {
                pass: false,
                message: () => 'Expected received and expected to be Arrays of same length',
            };
        }
        for (let i = 0; i < ne; ++i) {
            let ei = expected[i];
            let ri = received[i];
            let d = Math.abs(ei - ri);
            if (d > tol) {
                return {
                    pass: false,
                    message: () => `Expected result to be within tolerance (${tol})`
                        + `\nat index: ${i}`
                        + '\n\n'
                        + `Expected: ${this.utils.printExpected(ei)}\n`
                        + `Received: ${this.utils.printReceived(ri)}\n`
                        + `Diff: ${d}`,
                };

            }
        }
        return {
            actual: received,
            message: () => 'Expected received and expected to be similar.',
            pass: true
        };
    },

    nestedArrayCloseTo (received, expected, tol) {
        tol = (tol == null) ? 1e-10 : tol;
        if (!(Array.isArray(received) && Array.isArray(expected))) {
            return {
                pass: false,
                message: () => 'Expected received and expected to be nested Arrays',
            };
        }
        let nr = received.length;
        let ne = expected.length;
        if (nr !== ne) {
            return {
                pass: false,
                message: () => 'Expected received and expected to be nested Arrays of same length',
            };
        }
        for (let i = 0; i < ne; ++i) {
            let ei = expected[i];
            let nei = ei.length;
            let ri = received[i];
            let nri = ri.length;
            if (!(Array.isArray(ri) && Array.isArray(ei)) || (nri !== nei)) {
                return {
                    pass: false,
                    message: () => `Expected received and expected to be nested Arrays of same length.`
                        + `\n at index: ${i}`
                        + '\n\n'
                        + `Expected: ${this.utils.printExpected(ei)}\n`
                        + `Received: ${this.utils.printReceived(ri)}`,
                };
            }
            for (let j = 0; j < nei; ++j) {
                let d = Math.abs(ei[j] - ri[j]);
                if (d > tol) {
                    return {
                        pass: false,
                        message: () => `Expected result to be within tolerance (${tol})`
                            + `\nat index: ${i}, ${j}`
                            + '\n\n'
                            + `Expected: ${this.utils.printExpected(ei[j])}\n`
                            + `Received: ${this.utils.printReceived(ri[j])}\n`
                            + `Diff: ${d}`,
                    };
                }
            }
        }
        return {
            actual: received,
            message: () => 'Expected received and expected to be similar.',
            pass: true
        };
    },
});
