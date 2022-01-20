import * as R from './jsreal';
import * as K from './kernels';

declare global {
    interface Window { [key: string]: any }
}

window.R = R;
window.K = K;
