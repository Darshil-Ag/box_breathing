import { useEffect } from 'react';
import { motion, useAnimation, useMotionValue } from 'motion/react';

import './CircularText.css';

const getRotationTransition = (duration, from, loop = true) => ({
    from,
    to: from + 360,
    ease: 'linear',
    duration,
    type: 'tween',
    repeat: loop ? Infinity : 0
});

const getTransition = (duration, from) => ({
    rotate: getRotationTransition(duration, from),
    scale: {
        type: 'spring',
        damping: 20,
        stiffness: 300
    }
});

const CircularText = ({ text, spinDuration = 20, onHover = 'speedUp', className = '', children }) => {
    const letters = Array.from(text);
    const controls = useAnimation();
    const rotation = useMotionValue(0);

    useEffect(() => {
        const start = rotation.get();
        controls.start({
            rotate: start + 360,
            scale: 1,
            transition: getTransition(spinDuration, start)
        });
    }, [spinDuration, text, onHover, controls, rotation]);

    const handleHoverStart = () => {
        const start = rotation.get();
        if (!onHover) return;

        let transitionConfig;
        let scaleVal = 1;

        switch (onHover) {
            case 'slowDown':
                transitionConfig = getTransition(spinDuration * 2, start);
                break;
            case 'speedUp':
                transitionConfig = getTransition(spinDuration / 4, start);
                break;
            case 'pause':
                transitionConfig = {
                    rotate: { type: 'spring', damping: 20, stiffness: 300 },
                    scale: { type: 'spring', damping: 20, stiffness: 300 }
                };
                scaleVal = 1;
                break;
            case 'goBonkers':
                transitionConfig = getTransition(spinDuration / 20, start);
                scaleVal = 0.8;
                break;
            default:
                transitionConfig = getTransition(spinDuration, start);
        }

        controls.start({
            rotate: start + 360,
            scale: scaleVal,
            transition: transitionConfig
        });
    };

    const handleHoverEnd = () => {
        const start = rotation.get();
        controls.start({
            rotate: start + 360,
            scale: 1,
            transition: getTransition(spinDuration, start)
        });
    };

    return (
        <div className={`circular-text-wrapper ${className}`} style={{ position: 'relative', width: '200px', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div
                className="circular-text"
                style={{ rotate: rotation }}
                initial={{ rotate: 0 }}
                animate={controls}
                onMouseEnter={handleHoverStart}
                onMouseLeave={handleHoverEnd}
            >
                {letters.map((letter, i) => {
                    const rotationDeg = (360 / letters.length) * i;
                    const radius = 80; // Enlarged
                    const transform = `rotateZ(${rotationDeg}deg) translateY(-${radius}px)`;

                    return (
                        <span key={i} style={{ transform, WebkitTransform: transform }}>
                            {letter}
                        </span>
                    );
                })}
            </motion.div>
            <div className="circular-text-children" style={{ position: 'absolute', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {children}
            </div>
        </div>
    );
};

export default CircularText;
