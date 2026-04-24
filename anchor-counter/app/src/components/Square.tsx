import React from 'react';
import "./Square.scss";
import { motion } from "framer-motion";

type SquareProps = {
    ind?: number | string;
    updateSquares?: (index: number | string) => void;
    clsName?: string;
    placeholder?: React.ReactNode;
};

const Square: React.FC<SquareProps> = ({ ind, updateSquares, clsName, placeholder }) => {
    const handleClick = () => {
        if (updateSquares && ind !== undefined) {
            updateSquares(ind);
        }
    };
    const showPlaceholder = !clsName && !!placeholder;
    return (
        <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={`square${showPlaceholder ? ' square-placeholder' : ''}`}
            onClick={handleClick}
        >
            {clsName ? (
                <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className={`counter ${clsName}`}
                >
                    {clsName}
                </motion.span>
            ) : showPlaceholder ? (
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="placeholder"
                >
                    {placeholder}
                </motion.div>
            ) : null}
        </motion.div>
    );
};

export default Square;
