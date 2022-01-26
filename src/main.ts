import * as R from './jsreal';
import * as K from './kernels/kernel';

declare global {
    interface Window { [key: string]: any }
}

window.R = R;
window.LF = R.LongFloat;
window.K = K;
