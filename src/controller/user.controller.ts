import { HttpMessage, HttpStatus } from '../constant';
import { IinputVerificationByCode, IloginInput, IresendOtpInput, IsignupInput, IverifyOtpInput } from '../interface';
import dotenv from 'dotenv';
import { sign } from 'jsonwebtoken';
import { genSalt, hash, compare } from 'bcrypt';
dotenv.config();
import { User } from '../models';
import {
  AddMinutesToDate,
  GenerateCodeForEmail,
  generateOtp,
  generateUUID,
  sendMail,
  SendOtp,
  validateUUID,
} from '../utils';
import { logger, pubsub } from '../config';

const userResolverController = {
  createUser: async (parent: unknown, input: IsignupInput) => {
    try {
      const { email, first_name, last_name, password, phone } = input.input;
      logger.info('in create user controller');
      const userData = await User.findOne({
        where: {
          email,
        },
      });
      if (userData) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.USER_EXIST,
        };
      }
      const salt = await genSalt(12);
      const hashPassword = await hash(password, salt);
      const otpExpirationTime = await AddMinutesToDate(15);
      const userCreateData = await User.create({
        email,
        first_name,
        last_name,
        password: hashPassword,
        user_uuid: generateUUID(),
        phone,
        otp: generateOtp(),
        otp_expiration_time: otpExpirationTime,
        reset_token: await GenerateCodeForEmail(),
        token_expiration_time: await AddMinutesToDate(25),
      });
      await SendOtp(phone, userCreateData.otp);
      await sendMail(email, userCreateData.reset_token);
      return {
        status_code: HttpStatus.OK,
        message: HttpMessage.USER_CREATE_SUCCESSFULLY,
        data: userCreateData.dataValues,
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        return {
          status_code: HttpStatus.INTERNAL_SERVER_ERROR,
          message: err.message,
        };
      }
    }
  },
  verifyOtp: async (parent: unknown, input: IverifyOtpInput) => {
    try {
      const { otp, phone } = input.input;
      const userData = await User.findOne({
        where: {
          phone,
        },
      });
      if (!userData?.dataValues) {
        return {
          message: HttpMessage.SIGNUP_PLEASE,
        };
      }
      if (userData.dataValues.is_blocked === true) {
        logger.info(`${userData.dataValues.is_blocked}`);
        const bolckedTime = userData.dataValues?.blocked_at?.getTime();
        if ((bolckedTime as number) < new Date()?.getTime()) {
          const otpExpirationTime = await AddMinutesToDate(15);
          await User.update(
            {
              is_blocked: false,
              blocked_at: null,
              otp: generateOtp(),
              otp_expiration_time: otpExpirationTime,
              attempt: 0,
            },
            { where: { id: userData.dataValues.id } }
          );
          const updatedUserData = await User.findOne({ where: { id: userData.dataValues.id } });
          await SendOtp(`${updatedUserData?.dataValues.phone}`, updatedUserData?.dataValues.otp as number);
        }
        return {
          message: HttpMessage.ACCOUNT_BLOCKED_FOR_HALF_HOUR,
        };
      }
      if (userData.dataValues.is_phone_varified === true) {
        return {
          message: HttpMessage.ALREADY_VERIFIED,
        };
      }
      const otpExpirationTime = userData?.dataValues?.otp_expiration_time?.getTime();
      if ((otpExpirationTime as number) < new Date()?.getTime()) {
        return {
          message: HttpMessage.OTP_IS_EXPIRED,
        };
      }
      if (Number(otp) !== Number(userData.dataValues.otp)) {
        const count = userData.dataValues.attempt;
        if (count === 3) {
          await User.update(
            { is_blocked: true, blocked_at: await AddMinutesToDate(30) },
            {
              where: {
                id: userData.dataValues.id,
              },
            }
          );
          return {
            message: HttpMessage.ACCOUNT_BLOCKED_FOR_HALF_HOUR,
          };
        }
        await User.update({ attempt: Number(count) + 1 }, { where: { id: userData.dataValues.id } });
        return {
          message: HttpMessage.WRONG_OTP,
        };
      }

      if (Number(otp) === Number(userData.dataValues.otp)) {
        await User.update({ is_phone_varified: true }, { where: { id: userData.dataValues.id } });
        return {
          message: HttpMessage.OTP_VERIFIED_SUCCESSFULLY,
        };
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        return {
          status_code: HttpStatus.INTERNAL_SERVER_ERROR,
          message: err.message,
        };
      }
    }
  },
  resendOtp: async (parent: unknown, input: IresendOtpInput) => {
    try {
      const { user_uuid } = input.input;
      if (!validateUUID(user_uuid)) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.INVALID_ID,
        };
      }
      const userData = await User.findOne({ where: { user_uuid } });
      if (!userData?.dataValues) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.USER_NOT_FOUND,
        };
      }
      if (userData.dataValues.is_phone_varified === true) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.ALREADY_VERIFIED,
        };
      }
      if (userData.dataValues.is_blocked === true) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.ACCOUNT_BLOCKED,
        };
      }
      await User.update(
        {
          otp: generateOtp(),
          otp_expiration_time: await AddMinutesToDate(15),
        },
        { where: { user_uuid } }
      );
      const userUpdatedData = await User.findOne({ where: { user_uuid } });
      await SendOtp(`${userUpdatedData?.dataValues.phone}`, userUpdatedData?.dataValues.otp as number);
      return {
        status_code: HttpStatus.OK,
        message: HttpMessage.OTP_SEND,
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        return {
          status_code: HttpStatus.INTERNAL_SERVER_ERROR,
          message: err.message,
        };
      }
    }
  },
  resendTokenOnEmail: async (parent: unknown, input: IresendOtpInput) => {
    try {
      logger.info(`req.body==>  ${JSON.stringify(input).replace('\\', '')}`);
      const { user_uuid } = input.input;
      if (!validateUUID(user_uuid)) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.INVALID_ID,
        };
      }
      const userData = await User.findOne({ where: { user_uuid } });
      if (!userData?.dataValues) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.USER_NOT_FOUND,
        };
      }
      if (userData.dataValues.is_email_varified === true) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.ALREADY_VERIFIED,
        };
      }
      if (userData.dataValues.is_blocked === true) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.ACCOUNT_BLOCKED,
        };
      }
      await User.update(
        {
          reset_token: await GenerateCodeForEmail(),
          token_expiration_time: await AddMinutesToDate(25),
        },
        { where: { user_uuid } }
      );
      const userUpdatedData = await User.findOne({ where: { user_uuid } });
      await sendMail(userUpdatedData?.dataValues.email as string, userUpdatedData?.dataValues.reset_token as string);
      return {
        status_code: HttpStatus.OK,
        message: HttpMessage.CODE_SEND,
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        return {
          status_code: HttpStatus.INTERNAL_SERVER_ERROR,
          message: err.message,
        };
      }
    }
  },
  verifyEmailByToken: async (parent: unknown, input: IinputVerificationByCode) => {
    try {
      const { code, email } = input.input;
      const userData = await User.findOne({ where: { email } });
      if (!userData?.dataValues) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.USER_NOT_FOUND,
        };
      }
      if (userData.dataValues.is_email_varified === true) {
        return {
          status_code: HttpStatus.OK,
          message: HttpMessage.ALREADY_VERIFIED,
        };
      }
      const tokenExpirationTime = userData.dataValues?.token_expiration_time?.getTime();
      if ((tokenExpirationTime as number) < new Date()?.getTime()) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.YOUR_CODE_IS_EXPIRED,
        };
      }
      if (code.trim() !== userData?.dataValues.reset_token) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.CORRECT_TOKEN,
        };
      }
      if (code.trim() === userData?.dataValues.reset_token) {
        await User.update(
          {
            is_email_varified: true,
          },
          { where: { id: userData.dataValues.id } }
        );
        return {
          status_code: HttpStatus.OK,
          message: HttpMessage.TOKEN_VERIFICATION,
        };
      }

      return {
        status_code: HttpStatus.OK,
        message: HttpMessage.OK,
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        return {
          status_code: HttpStatus.INTERNAL_SERVER_ERROR,
          message: err.message,
        };
      }
    }
  },
  login: async (any: unknown, input: IloginInput) => {
    try {
      const { email, password } = input.input;
      logger.info('login');
      const userData = await User.findOne({ where: { email } });
      if (!userData) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.USER_NOT_FOUND,
        };
      }
      const passwordCompare = await compare(password, userData.dataValues.password as string);
      if (!passwordCompare) {
        return {
          status_code: HttpStatus.BAD_REQUEST,
          message: HttpMessage.INVALID_CREDENTIAL,
        };
      }
      const token = await sign({ id: userData.dataValues.user_uuid }, String(process.env.MY_SECRET), {
        expiresIn: '1d',
      });
      return {
        status_code: HttpStatus.OK,
        message: HttpMessage.LOGIN_SUCCESSFULLY,
        token: token,
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        return {
          status_code: HttpStatus.INTERNAL_SERVER_ERROR,
          message: err.message,
        };
      }
    }
  },
};

const userQueryController = {
  books: async () => {
    try {
      pubsub.publish('COMMENT_ADDED', { data: '2' });
      return 'hello ';
    } catch (err: unknown) {
      if (err instanceof Error) {
        return {
          status_code: HttpStatus.INTERNAL_SERVER_ERROR,
          message: err.message,
        };
      }
    }
  },
};
export { userResolverController, userQueryController };
