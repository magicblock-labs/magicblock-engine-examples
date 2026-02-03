import React from 'react';
import "./Square.scss";
import { motion } from "framer-motion";

type SquareProps = {
    ind?: number | string;
    updateSquares?: (index: number | string) => void;
    clsName?: string;
};

const Square: React.FC<SquareProps> = ({ ind, updateSquares, clsName }) => {
    const handleClick = () => {
        if (updateSquares && ind !== undefined) {
            updateSquares(ind);
        }
    };
    return (
        <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="square"
            onClick={handleClick}
        >
            {clsName && (
                <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className={`counter ${clsName}`}
                >
                    {clsName}
                </motion.span>
            )}
        </motion.div>
    );
};

export default Square;
